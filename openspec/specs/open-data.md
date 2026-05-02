# Open Data

> Domain spec — 見 [overview.md](./overview.md) 了解整體架構。
> 前置條件：需先呼叫 `member_token` — 見 [authentication.md](./authentication.md)。

## Purpose

提供三個工具存取司法院開放資料平台 (`opendata.judicial.gov.tw`)：
- `list_categories`：取得所有主題分類清單
- `list_resources`：取得指定分類下的資料源清單
- `download_file`：下載指定檔案集的資料，支援分頁（`top` / `skip`）

`download_file` 回傳 binary blob，與其餘工具的 text JSON response 格式不同。

## Upstream Endpoints

| 工具 | Method | URL |
|-----|--------|-----|
| `list_categories` | GET | `https://opendata.judicial.gov.tw/data/api/rest/categories` |
| `list_resources` | GET | `https://opendata.judicial.gov.tw/data/api/rest/categories/{categoryNo}/resources` |
| `download_file` | GET | `https://opendata.judicial.gov.tw/api/FilesetLists/{fileSetId}/file[?top=N&skip=N]` |

三工具均使用 `Authorization: Bearer {token}` header，token 來自 `member_token`。

## Call Flow

```
member_token
  → list_categories(token)          → 取得 categoryNo
  → list_resources(categoryNo, token) → 取得 fileSetId
  → download_file(fileSetId, token)   → 取得二進位檔案
```

## Behavior

### list_categories（`src/tools.js:227`）

```
GIVEN client 持有有效的 member_token
WHEN  client 呼叫 list_categories，傳入 { token }
THEN  validateInput.required(args, ['token'])
      validateInput.token(args.token)
      GET https://opendata.judicial.gov.tw/data/api/rest/categories
          header: Authorization: Bearer {token}
      回傳上游回應原始 data，由 createSuccessResponse 包裝

GIVEN token 無效或上游回傳非 2xx
THEN  拋出 Error: `取得主題分類清單失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

### list_resources（`src/tools.js:243`）

```
GIVEN client 持有有效的 member_token 與從 list_categories 取得的 categoryNo
WHEN  client 呼叫 list_resources，傳入 { categoryNo, token }
THEN  validateInput.required(args, ['categoryNo', 'token'])
      validateInput.token(args.token)
      GET https://opendata.judicial.gov.tw/data/api/rest/categories/{categoryNo}/resources
          header: Authorization: Bearer {token}
      回傳上游回應原始 data，由 createSuccessResponse 包裝

GIVEN categoryNo 包含非數字字元
WHEN  validateInput.numericString 執行
THEN  拋出 Error: `categoryNo 必須是數字字串`
      由 createErrorResponse 包裝，isError: true
      注意：validateInput.numericString 已定義於 src/tools.js:40，
            但 list_resources handler 目前未呼叫此驗證（src/tools.js:244-245）

GIVEN 上游回傳非 2xx
THEN  拋出 Error: `取得資料源清單失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

### download_file（`src/tools.js:260`）

```
GIVEN client 持有有效的 member_token 與從 list_resources 取得的 fileSetId
WHEN  client 呼叫 download_file，傳入 { fileSetId, token }（top、skip 可選）
THEN  validateInput.required(args, ['fileSetId', 'token'])
      validateInput.token(args.token)
      若 top 存在，附加 ?top={top} 到 URL
      若 skip 存在，附加 &skip={skip} 到 URL（使用 URLSearchParams）
      GET https://opendata.judicial.gov.tw/api/FilesetLists/{fileSetId}/file[?top=N&skip=N]
          header: Authorization: Bearer {token}
          responseType: 'arraybuffer'
      從 response header 讀取 content-type（缺省為 'application/octet-stream'）
      呼叫 createBlobResponse(Buffer.from(result.data), mimeType, `data:{mimeType};base64`)
      回傳 MCP resource content type（非 text type）

GIVEN top 或 skip 未提供
THEN  對應 URLSearchParams 欄位不附加，不影響其他參數

GIVEN 上游回傳非 2xx
THEN  拋出 Error: `檔案下載失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

## Input Schema

### list_categories

```json
{
  "type": "object",
  "properties": {
    "token": { "type": "string", "description": "從 member_token 工具取得的會員授權 Token" }
  },
  "required": ["token"],
  "additionalProperties": false
}
```

### list_resources

```json
{
  "type": "object",
  "properties": {
    "categoryNo": { "type": "string", "description": "從 list_categories 工具取得的分類編號" },
    "token":      { "type": "string", "description": "從 member_token 工具取得的會員授權 Token" }
  },
  "required": ["categoryNo", "token"],
  "additionalProperties": false
}
```

### download_file

```json
{
  "type": "object",
  "properties": {
    "fileSetId": { "type": "string",  "description": "從 list_resources 工具取得的檔案集 ID" },
    "top":       { "type": "integer", "description": "限制回傳筆數（可選）", "minimum": 0 },
    "skip":      { "type": "integer", "description": "跳過筆數，用於分頁（可選）", "minimum": 0 },
    "token":     { "type": "string",  "description": "從 member_token 工具取得的會員授權 Token" }
  },
  "required": ["fileSetId", "token"],
  "additionalProperties": false
}
```

## Response Format Difference

`download_file` 是唯一回傳 `content[type='resource']` 的工具：

```json
{
  "content": [{
    "type": "resource",
    "resource": {
      "uri": "data:{mimeType};base64",
      "mimeType": "{from response header}",
      "blob": "{base64-encoded string}"
    }
  }]
}
```

其餘兩工具回傳 `content[type='text']`（JSON 字串）。
詳細格式規範見 [mcp-protocol.md](./mcp-protocol.md)。

## Known Gap

`validateInput.numericString` 已定義於 `src/tools.js:40`，但 `list_resources` handler
（`src/tools.js:244`）未呼叫此驗證。若 `categoryNo` 含非數字字元，不會在本 server 端攔截，
直接傳至上游，由上游決定是否拒絕。

## Dependencies

- `src/response.js` — `createSuccessResponse`、`createErrorResponse`、`createBlobResponse`（見 [mcp-protocol.md](./mcp-protocol.md)）
- `member_token` 工具（見 [authentication.md](./authentication.md)）

## Non-goals

- 不解析下載檔案內容；blob 直接以 base64 回傳給 client。
- 不管理分頁 cursor；client 需自行計算 skip 偏移量。
