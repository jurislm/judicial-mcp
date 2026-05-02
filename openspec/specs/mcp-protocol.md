# MCP Protocol — Response Format

> 橫切關注點 spec — 適用所有工具 handler。見 [overview.md](./overview.md) 了解整體架構。

## Purpose

定義 `src/response.js` 提供的三個 MCP CallToolResult 格式化函式的語意與使用規範，
確保所有工具 handler 的回應格式符合 MCP 規範。

## MCP CallToolResult 規範

```
CallToolResult = {
  content: ContentBlock[]   // 必填，至少一個元素
  isError?: boolean         // 可選；省略代表 false（成功）
}

ContentBlock =
  | { type: 'text',     text: string }
  | { type: 'resource', resource: ResourceContent }
```

`isError: true` 使 MCP client 能分辨工具層錯誤與成功回應，
不同於 MCP 協議層錯誤（由 `server.onerror` 處理，`src/index.js:46`）。

## Functions

### createSuccessResponse（`src/response.js:15`）

```
GIVEN 任意可序列化的 data
WHEN  呼叫 createSuccessResponse(data)
THEN  回傳 { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      isError 欄位省略（MCP 規範預設為 false）
```

使用場景：所有工具成功回傳上游 JSON 資料時（`download_file` 除外）。

### createErrorResponse（`src/response.js:31`）

```
GIVEN Error 物件或任意物件 error，以及描述字串 message
WHEN  呼叫 createErrorResponse(error, message)
THEN  detail = error?.response?.data ?? error?.message ?? String(error)
      回傳 {
        content: [{ type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) }],
        isError: true
      }
```

detail 提取優先順序：
1. `error.response.data`（axios HTTP 錯誤，含上游回應 body）
2. `error.message`（標準 Error 物件）
3. `String(error)`（fallback）

使用場景：`src/index.js:70`，所有工具 handler 拋出例外時統一處理。

### createBlobResponse（`src/response.js:52`）

```
GIVEN Buffer 或 string 型別的 data，mimeType 字串，uri 字串
WHEN  呼叫 createBlobResponse(data, mimeType, uri)
THEN  回傳 {
        content: [{
          type: 'resource',
          resource: {
            uri,
            mimeType,
            blob: Buffer.isBuffer(data) ? data.toString('base64') : data
          }
        }]
      }
      isError 欄位省略（成功）
```

使用場景：僅用於 `download_file` handler（`src/tools.js:283`），
傳入參數為 `(Buffer.from(result.data), mimeType, 'data:{mimeType};base64')`。

## Routing Logic（`src/index.js:53`）

```
GIVEN TOOL_HANDLERS[name] 存在
WHEN  工具 handler 回傳值的 result?.content 為 Array
THEN  直接 return result（download_file 的 blob 路徑，繞過 createSuccessResponse）

GIVEN TOOL_HANDLERS[name] 存在
WHEN  工具 handler 回傳值不具備 content Array 結構
THEN  return createSuccessResponse(result)

GIVEN TOOL_HANDLERS[name] 不存在
WHEN  client 傳入未知 name
THEN  拋出 Error: `未知的工具: ${name}`
      由 createErrorResponse 包裝，isError: true
```

## Stdout 保護（`src/index.js:10`）

MCP stdio transport 要求 stdout 只能傳輸 JSON-RPC 訊息。
`console.log`、`console.info`、`console.warn` 在 server 啟動時被重定向至 stderr：

```js
console.log = console.info = console.warn = (...args) => process.stderr.write(args.join(' ') + '\n');
```

`console.error` 保留原始行為（輸出至 stderr，符合規範）。

## Dependencies

- `@modelcontextprotocol/sdk` — `CallToolRequestSchema`、`ListToolsRequestSchema`
- `src/tools.js` — `TOOLS_CONFIG`、`TOOL_HANDLERS`
