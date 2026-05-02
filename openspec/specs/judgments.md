# Judgments

> Domain spec — 見 [overview.md](./overview.md) 了解整體架構。
> 前置條件：需先呼叫 `auth_token` — 見 [authentication.md](./authentication.md)。

## Purpose

提供兩個工具存取司法院裁判書查詢 API：
- `list_judgments`：取得裁判書異動清單（新增、修改、刪除）
- `get_judgment`：依 `jid` 取得裁判書完整全文

## Upstream Endpoints

| 工具 | Method | URL |
|-----|--------|-----|
| `list_judgments` | POST | `https://data.judicial.gov.tw/jdg/api/JList` |
| `get_judgment` | POST | `https://data.judicial.gov.tw/jdg/api/JDoc` |

## Call Flow

```
auth_token → list_judgments(token) → 取得 jid → get_judgment(token, jid)
```

`jid` 從 `list_judgments` 回傳的清單中取得，不可自行構造。

## Behavior

### list_judgments（`src/tools.js:200`）

```
GIVEN client 持有有效的 auth_token
WHEN  client 呼叫 list_judgments，傳入 { token }
THEN  validateInput.required(args, ['token'])
      validateInput.token(args.token)
      POST https://data.judicial.gov.tw/jdg/api/JList { token }
      回傳上游回應原始 data，由 createSuccessResponse 包裝

GIVEN token 為空字串、非字串、或只含空白
WHEN  client 呼叫 list_judgments
THEN  validateInput.token 拋出 Error: '無效的授權 Token'
      由 createErrorResponse 包裝，isError: true

GIVEN token 有效但上游回傳非 2xx
WHEN  axios.post 拋出例外
THEN  拋出 Error: `取得裁判書清單失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

### get_judgment（`src/tools.js:212`）

```
GIVEN client 持有有效的 auth_token 與從 list_judgments 取得的 jid
WHEN  client 呼叫 get_judgment，傳入 { token, jid }
THEN  validateInput.required(args, ['token', 'jid'])
      validateInput.token(args.token)
      POST https://data.judicial.gov.tw/jdg/api/JDoc { token, j: jid }
      注意：上游參數鍵名為 'j'，非 'jid'（見 src/tools.js:219）
      回傳上游回應原始 data，由 createSuccessResponse 包裝

GIVEN token 或 jid 任一缺少
WHEN  client 呼叫 get_judgment
THEN  validateInput.required 拋出 Error: `缺少必要參數: ${欄位名}`
      由 createErrorResponse 包裝，isError: true

GIVEN 參數完整但上游回傳非 2xx
WHEN  axios.post 拋出例外
THEN  拋出 Error: `取得裁判書內容失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

## Input Schema

### list_judgments

```json
{
  "type": "object",
  "properties": {
    "token": { "type": "string", "description": "從 auth_token 工具取得的授權 Token" }
  },
  "required": ["token"],
  "additionalProperties": false
}
```

### get_judgment

```json
{
  "type": "object",
  "properties": {
    "token": { "type": "string", "description": "從 auth_token 工具取得的授權 Token" },
    "jid":   { "type": "string", "description": "從 list_judgments 工具取得的裁判書 ID" }
  },
  "required": ["token", "jid"],
  "additionalProperties": false
}
```

## Implementation Note

`get_judgment` 傳送給上游的 request body 使用 `j` 作為裁判書 ID 的鍵名
（`{ token: args.token, j: args.jid }`，`src/tools.js:218-219`），
與 inputSchema 中的 `jid` 欄位名稱不同。

## Dependencies

- `src/response.js` — `createSuccessResponse`、`createErrorResponse`（見 [mcp-protocol.md](./mcp-protocol.md)）
- `auth_token` 工具（見 [authentication.md](./authentication.md)）

## Non-goals

- 不提供裁判書搜尋（全文檢索）；僅取得異動清單與指定全文。
- 不解析裁判書內容結構；原始資料直接回傳給 client。
