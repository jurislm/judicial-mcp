/**
 * @file src/tools.js
 * @description MCP 工具定義和配置
 */

const axios = require('axios');
const { createBlobResponse } = require('./response.js');

/**
 * 輸入驗證工具函數
 */
const validateInput = {
  /**
   * 驗證必要參數是否存在
   * @param {Object} params - 參數物件
   * @param {Array<string>} required - 必要參數名稱陣列
   */
  required(params, required) {
    const missing = required.filter(key => !params[key]);
    if (missing.length > 0) {
      throw new Error(`缺少必要參數: ${missing.join(', ')}`);
    }
  },

  /**
   * 驗證 Token 格式
   * @param {string} token - 授權 Token
   */
  token(token) {
    if (!token || typeof token !== 'string' || token.trim().length === 0) {
      throw new Error('無效的授權 Token');
    }
  },

  /**
   * 驗證數字字串格式
   * @param {string} value - 要驗證的值
   * @param {string} fieldName - 欄位名稱
   */
  numericString(value, fieldName) {
    if (value && !/^\d+$/.test(value)) {
      throw new Error(`${fieldName} 必須是數字字串`);
    }
  }
};

/**
 * 司法院 API 基礎配置
 */
const JUDICIAL_API_BASE = 'https://data.judicial.gov.tw/jdg/api';
const OPENDATA_API_BASE = 'https://opendata.judicial.gov.tw';

/**
 * 工具定義配置
 */
const TOOLS_CONFIG = {
  auth_token: {
    name: 'auth_token',
    description: '取得司法院裁判書查詢系統的授權 Token。帳密從環境變數 JUDICIAL_USER / JUDICIAL_PASSWORD 讀取。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  },

  list_judgments: {
    name: 'list_judgments',
    description: '取得裁判書異動清單，包含新增、修改或刪除的裁判書資訊。',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: '從 auth_token 工具取得的授權 Token'
        }
      },
      required: ['token'],
      additionalProperties: false
    }
  },

  get_judgment: {
    name: 'get_judgment',
    description: '取得特定裁判書的完整內容，包含裁判全文。',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: '從 auth_token 工具取得的授權 Token'
        },
        jid: {
          type: 'string',
          description: '從 list_judgments 工具取得的裁判書 ID'
        }
      },
      required: ['token', 'jid'],
      additionalProperties: false
    }
  },

  list_categories: {
    name: 'list_categories',
    description: '取得司法院開放資料平台的所有主題分類清單。',
    inputSchema: {
      type: 'object',
      properties: {
        token: {
          type: 'string',
          description: '從 member_token 工具取得的會員授權 Token'
        }
      },
      required: ['token'],
      additionalProperties: false
    }
  },

  list_resources: {
    name: 'list_resources',
    description: '取得指定分類下的所有資料源清單。',
    inputSchema: {
      type: 'object',
      properties: {
        categoryNo: {
          type: 'string',
          description: '從 list_categories 工具取得的分類編號'
        },
        token: {
          type: 'string',
          description: '從 member_token 工具取得的會員授權 Token'
        }
      },
      required: ['categoryNo', 'token'],
      additionalProperties: false
    }
  },

  download_file: {
    name: 'download_file',
    description: '下載指定檔案集的資料檔案，支援分頁參數。',
    inputSchema: {
      type: 'object',
      properties: {
        fileSetId: {
          type: 'string',
          description: '從 list_resources 工具取得的檔案集 ID'
        },
        top: {
          type: 'integer',
          description: '限制回傳筆數（可選）',
          minimum: 0
        },
        skip: {
          type: 'integer',
          description: '跳過筆數，用於分頁（可選）',
          minimum: 0
        },
        token: {
          type: 'string',
          description: '從 member_token 工具取得的會員授權 Token'
        }
      },
      required: ['fileSetId', 'token'],
      additionalProperties: false
    }
  },

  member_token: {
    name: 'member_token',
    description: '取得司法院開放平台的會員授權 Token，用於存取會員專屬資源。帳密從環境變數 JUDICIAL_USER / JUDICIAL_PASSWORD 讀取。',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    }
  }
};

/**
 * 工具執行器映射
 */
const TOOL_HANDLERS = {
  async auth_token(_args) {
    const user = process.env.JUDICIAL_USER;
    const password = process.env.JUDICIAL_PASSWORD;

    if (!user || !password) {
      throw new Error('未提供使用者帳號或密碼，且環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 未設定');
    }

    try {
      const result = await axios.post(`${JUDICIAL_API_BASE}/Auth`, { user, password });
      return result.data;
    } catch (error) {
      throw new Error(`授權失敗: ${error.response?.data?.message || error.message}`);
    }
  },

  async list_judgments(args) {
    validateInput.required(args, ['token']);
    validateInput.token(args.token);

    try {
      const result = await axios.post(`${JUDICIAL_API_BASE}/JList`, { token: args.token });
      return result.data;
    } catch (error) {
      throw new Error(`取得裁判書清單失敗: ${error.response?.data?.message || error.message}`);
    }
  },

  async get_judgment(args) {
    validateInput.required(args, ['token', 'jid']);
    validateInput.token(args.token);

    try {
      const result = await axios.post(`${JUDICIAL_API_BASE}/JDoc`, {
        token: args.token,
        j: args.jid
      });
      return result.data;
    } catch (error) {
      throw new Error(`取得裁判書內容失敗: ${error.response?.data?.message || error.message}`);
    }
  },

  async list_categories(args) {
    validateInput.required(args, ['token']);
    validateInput.token(args.token);

    try {
      const result = await axios.get(`${OPENDATA_API_BASE}/data/api/rest/categories`, {
        headers: {
          'Authorization': `Bearer ${args.token}`
        }
      });
      return result.data;
    } catch (error) {
      throw new Error(`取得主題分類清單失敗: ${error.response?.data?.message || error.message}`);
    }
  },

  async list_resources(args) {
    validateInput.required(args, ['categoryNo', 'token']);
    validateInput.token(args.token);

    try {
      const url = `${OPENDATA_API_BASE}/data/api/rest/categories/${args.categoryNo}/resources`;
      const result = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${args.token}`
        }
      });
      return result.data;
    } catch (error) {
      throw new Error(`取得資料源清單失敗: ${error.response?.data?.message || error.message}`);
    }
  },

  async download_file(args) {
    validateInput.required(args, ['fileSetId', 'token']);
    validateInput.token(args.token);

    try {
      const params = new URLSearchParams();
      if (args.top != null) params.append('top', String(args.top));
      if (args.skip != null) params.append('skip', String(args.skip));

      let url = `${OPENDATA_API_BASE}/api/FilesetLists/${args.fileSetId}/file`;
      if (params.toString()) {
        url += `?${params.toString()}`;
      }

      const result = await axios.get(url, {
        responseType: 'arraybuffer',
        headers: {
          'Authorization': `Bearer ${args.token}`
        }
      });

      const mimeType = result.headers['content-type'] || 'application/octet-stream';
      const uri = `data:${mimeType};base64`;
      return createBlobResponse(Buffer.from(result.data), mimeType, uri);
    } catch (error) {
      throw new Error(`檔案下載失敗: ${error.response?.data?.message || error.message}`);
    }
  },

  async member_token(_args) {
    const user = process.env.JUDICIAL_USER;
    const password = process.env.JUDICIAL_PASSWORD;

    if (!user || !password) {
      throw new Error('未提供使用者帳號或密碼，且環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 未設定');
    }

    try {
      const result = await axios.post(`${OPENDATA_API_BASE}/api/MemberTokens`, {
        memberAccount: user,
        pwd: password
      });
      return result.data;
    } catch (error) {
      throw new Error(`會員授權失敗: ${error.response?.data?.message || error.message}`);
    }
  }
};

module.exports = {
  TOOLS_CONFIG,
  TOOL_HANDLERS
};