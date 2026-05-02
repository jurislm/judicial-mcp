# Authentication

> Domain spec — 見 [overview.md](./overview.md) 了解整體架構。

## Purpose

提供兩個工具讓 MCP client 取得各自 API 系統的授權 Token：
- `auth_token`：用於裁判書查詢 API（`JUDICIAL_API_BASE`）
- `member_token`：用於開放資料平台 API（`OPENDATA_API_BASE`）

兩工具共用同一組環境變數帳密，但對接不同的上游 endpoint，回傳格式亦不同。

## Upstream Endpoints

| 工具 | Method | URL |
|-----|--------|-----|
| `auth_token` | POST | `https://data.judicial.gov.tw/jdg/api/Auth` |
| `member_token` | POST | `https://opendata.judicial.gov.tw/api/MemberTokens` |

## Credential Source

兩工具均從 Node.js 進程環境變數讀取帳密，不接受 client 傳入參數：

```
process.env.JUDICIAL_USER      → auth_token 的 { user }    / member_token 的 { memberAccount }
process.env.JUDICIAL_PASSWORD  → auth_token 的 { password } / member_token 的 { pwd }
```

帳密欄位名稱不同（`user`/`password` vs `memberAccount`/`pwd`）是上游 API 的設計，非本 server 差異。

## Behavior

### auth_token（`src/tools.js:184`）

```
GIVEN 環境變數 JUDICIAL_USER 與 JUDICIAL_PASSWORD 均已設定
WHEN  client 呼叫 auth_token（inputSchema 無必要參數）
THEN  POST https://data.judicial.gov.tw/jdg/api/Auth { user, password }
      回傳上游回應原始 data（JSON），由 createSuccessResponse 包裝

GIVEN 環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 任一未設定
WHEN  client 呼叫 auth_token
THEN  拋出 Error: '未提供使用者帳號或密碼，且環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 未設定'
      由 createErrorResponse 包裝，isError: true

GIVEN 環境變數已設定但上游回傳非 2xx
WHEN  axios.post 拋出例外
THEN  拋出 Error: `授權失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

### member_token（`src/tools.js:289`）

```
GIVEN 環境變數 JUDICIAL_USER 與 JUDICIAL_PASSWORD 均已設定
WHEN  client 呼叫 member_token（inputSchema 無必要參數）
THEN  POST https://opendata.judicial.gov.tw/api/MemberTokens { memberAccount, pwd }
      回傳上游回應原始 data（JSON），由 createSuccessResponse 包裝

GIVEN 環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 任一未設定
WHEN  client 呼叫 member_token
THEN  拋出 Error: '未提供使用者帳號或密碼，且環境變數 JUDICIAL_USER 或 JUDICIAL_PASSWORD 未設定'
      由 createErrorResponse 包裝，isError: true

GIVEN 環境變數已設定但上游回傳非 2xx
WHEN  axios.post 拋出例外
THEN  拋出 Error: `會員授權失敗: ${error.response?.data?.message || error.message}`
      由 createErrorResponse 包裝，isError: true
```

## Input / Output Schema

### auth_token

```json
{
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
}
```

### member_token

```json
{
  "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false }
}
```

Output 為上游 JSON 原始回應，本 server 不做結構轉換。

## Dependencies

- `src/response.js` — `createSuccessResponse`、`createErrorResponse`（見 [mcp-protocol.md](./mcp-protocol.md)）
- `process.env.JUDICIAL_USER`、`process.env.JUDICIAL_PASSWORD`

## Non-goals

- 不快取 token；呼叫者需自行管理 token 生命週期。
- 不自動重試；上游錯誤直接回傳給 client。
- 不支援多組帳密切換；每個 server 進程對應一組帳密。
