# MCP Protocol — Response Format

> 橫切關注點 spec — 適用所有工具 handler。見 [overview.md](./overview.md) 了解整體架構。

## Purpose

定義 `src/response.ts` 提供的三個 MCP CallToolResult 格式化函式的語意與使用規範，
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
不同於 MCP 協議層錯誤（由 `server.onerror` 處理，`src/server.ts:23`）。

## Functions

### createSuccessResponse（`src/response.ts:10`）

```
GIVEN 任意可序列化的 data
WHEN  呼叫 createSuccessResponse(data)
THEN  回傳 { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
      isError 欄位省略（MCP 規範預設為 false）
```

使用場景：所有工具成功回傳上游 JSON 資料時（`download_file` 除外）。

### createErrorResponse（`src/response.ts:19`）

```
GIVEN Error 物件或任意物件 error，以及描述字串 message
WHEN  呼叫 createErrorResponse(error, message)
THEN  若 error 為含 'response' 鍵的物件 → detail = error.response?.data  // axios body，可為 undefined
      若 error instanceof Error         → detail = error.message
      否則                               → detail = String(error)
      回傳 {
        content: [{ type: 'text', text: JSON.stringify({ error: message, detail }, null, 2) }],
        isError: true
      }
```

detail 提取（三個分支**互斥**，非 ?? 鏈）：
1. `error.response.data`：error 為含 `response` 鍵的物件（axios 錯誤）；data 可為 `undefined`，不回落至 error.message
2. `error.message`：error instanceof Error（且無 `response` 鍵）
3. `String(error)`：其他所有情況

使用場景：`src/server.ts:50`，所有工具 handler 拋出例外時統一處理。

### createBlobResponse（`src/response.ts:38`）

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

使用場景：僅用於 `download_file` handler（`src/tools.ts:235`），
傳入參數為 `(Buffer.from(result.data as ArrayBuffer), mimeType, uri)`，
其中 `uri` 為 runtime template literal，格式為 `data:<mimeType>;base64`（例：`data:application/zip;base64`）。

## Routing Logic（`src/server.ts:27`）

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

## Stdout 保護（`src/index.ts:5`）

MCP stdio transport 要求 stdout 只能傳輸 JSON-RPC 訊息。
`console.log`、`console.info`、`console.warn` 在 server 啟動時被重定向至 stderr：

```ts
console.log = console.info = console.warn = (...args: unknown[]) =>
  process.stderr.write(args.join(' ') + '\n')
```

`console.error` 保留原始行為（輸出至 stderr，符合規範）。

## Dependencies

- `@modelcontextprotocol/sdk` — `CallToolRequestSchema`、`ListToolsRequestSchema`
- `src/tools.ts` — `TOOLS_CONFIG`、`TOOL_HANDLERS`
