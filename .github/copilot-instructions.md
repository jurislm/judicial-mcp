請使用繁體中文回覆所有問題與建議。

# Copilot Instructions for judicial-mcp

## Project Overview

`judicial-mcp` 是台灣司法院公開資料的 MCP (Model Context Protocol) Server，提供 7 個工具存取裁判書全文與開放資料平台。使用 Node.js **CommonJS**（非 TypeScript、非 ESM）。

## Git Workflow

- **Development branch**: `develop` — all feature work happens here
- **Release branch**: `main` — receives changes via **squash merge** from `develop`
- **Versioning**: Managed by Release Please. Do NOT suggest manual version bumps.

## Runtime: Node.js CommonJS

- 使用 `require()`/`module.exports`，**禁止** `import`/`export`
- 禁止建議轉換為 TypeScript 或 ESM

## Build & Test

```bash
node src/index.js          # 啟動 MCP server（stdio transport）
npm test                   # Jest 測試
npm run lint               # ESLint
```

Required environment variables:

```bash
export JUDICIAL_USER=<帳號>
export JUDICIAL_PASSWORD=<密碼>
```

## Tool Definitions (7 tools)

所有工具定義在 `src/tools.js` 的 `TOOLS_CONFIG`，handler 在 `TOOL_HANDLERS`：

### 裁判書查詢 API（`data.judicial.gov.tw/jdg/api`）

| Tool | Auth | Description |
|------|------|-------------|
| `auth_token` | env JUDICIAL_USER/PASSWORD | 取得裁判書系統授權 Token |
| `list_judgments` | token | 取得裁判書異動清單（新增/修改/刪除） |
| `get_judgment` | token + jid | 取得特定裁判書全文 |

### 開放資料平台（`opendata.judicial.gov.tw`）

| Tool | Auth | Description |
|------|------|-------------|
| `member_token` | env JUDICIAL_USER/PASSWORD | 取得開放平台會員 Token（Bearer） |
| `list_categories` | Bearer token | 取得所有主題分類 |
| `list_resources` | Bearer token + categoryNo | 取得指定分類的資料源 |
| `download_file` | Bearer token + fileSetId | 下載資料檔案（支援分頁 top/skip） |

## 兩套 API 的差異

| 系統 | Base URL | 認證方式 | Token 取得 |
|------|----------|----------|-----------|
| 裁判書系統 | `data.judicial.gov.tw/jdg/api` | POST body `token` 欄位 | `auth_token` |
| 開放資料平台 | `opendata.judicial.gov.tw` | HTTP Header `Authorization: Bearer <token>` | `member_token` |

## Code Patterns

### 回應格式

- 一般工具：回傳 `createSuccessResponse(data)`
- 檔案下載：`download_file` 直接回傳 MCP resource 格式（含 `content` 陣列）
- 錯誤：`createErrorResponse(error, message)` — 定義在 `src/response.js`

### 輸入驗證

使用 `src/tools.js` 中的 `validateInput` 物件：
- `validateInput.required(params, ['token', 'jid'])` — 必要參數檢查
- `validateInput.token(token)` — Token 格式驗證
- `validateInput.numericString(value, fieldName)` — 數字字串格式

### 日誌輸出

`stdout` 保留給 MCP protocol，所有日誌輸出到 `stderr`：
```javascript
// index.js 頂層已全域重定向
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(' ') + '
');
```

## Code Review 重點

- **日期格式驗證**：司法院資料常見日期格式問題——民國年（ROC，需 +1911 轉換）、CRLF 行尾、多段 JID（如 `110-訴-1234`）
- **禁止** `eval()`、`new Function()`
- **JUDICIAL_USER** / **JUDICIAL_PASSWORD** 禁止 hardcode
- 用戶輸入直接拼接到 URL path（`/categories/${id}/resources`）需確認 `encodeURIComponent`
- `async` 函式缺少 try/catch 需提醒

## Testing

- 測試框架：Jest（`jest.fn()`、`jest.mock()`），禁止 Vitest API
- 測試檔案在 `__tests__/`

## 忽略範圍

- 不審查 `node_modules/`、`coverage/` 目錄
- 不對自動生成的 mock 檔案提出風格建議
