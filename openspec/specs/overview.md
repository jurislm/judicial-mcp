# judicial-mcp — Server Overview

## Purpose

`@jurislm/judicial-mcp` 是一個 MCP (Model Context Protocol) Server，以 stdio transport 運行，
提供 7 個工具供 MCP client（如 Claude Code）透過自然語言存取台灣司法院的裁判書查詢系統
與開放資料平台。

## Architecture

```
src/index.js          — MCP Server 主程式（啟動、工具路由、協議錯誤處理）
src/tools.js          — TOOLS_CONFIG（工具定義）+ TOOL_HANDLERS（工具執行器）
src/response.js       — MCP CallToolResult 格式化工具函式
bin/judicial-mcp.js   — CLI 入口點（供 bunx / npx 呼叫）
```

進程環境變數：`JUDICIAL_USER`、`JUDICIAL_PASSWORD`（兩套 API 共用同一組帳密）。

## Domains

| Domain | Spec | 說明 |
|--------|------|------|
| Authentication | [authentication.md](./authentication.md) | 取得裁判書授權 Token 與開放資料會員 Token |
| Judgments | [judgments.md](./judgments.md) | 裁判書異動清單查詢與全文取得 |
| Open Data | [open-data.md](./open-data.md) | 主題分類、資料源清單、檔案分頁下載 |
| MCP Protocol | [mcp-protocol.md](./mcp-protocol.md) | CallToolResult 格式規範（橫切所有 domain） |

## Tool Registry

| 工具名稱 | Domain | 所需前置 token | 程式碼位置 |
|---------|--------|--------------|-----------|
| `auth_token` | Authentication | 無 | `src/tools.js:184` |
| `member_token` | Authentication | 無 | `src/tools.js:289` |
| `list_judgments` | Judgments | `auth_token` | `src/tools.js:200` |
| `get_judgment` | Judgments | `auth_token` | `src/tools.js:212` |
| `list_categories` | Open Data | `member_token` | `src/tools.js:227` |
| `list_resources` | Open Data | `member_token` | `src/tools.js:243` |
| `download_file` | Open Data | `member_token` | `src/tools.js:260` |

## Typical Call Flows

**裁判書查詢**
```
auth_token → list_judgments → get_judgment(jid)
```

**開放資料下載**
```
member_token → list_categories → list_resources(categoryNo) → download_file(fileSetId)
```

## Non-goals

- 不提供 HTTP REST API；僅支援 stdio MCP transport。
- 不快取 token；每次工具呼叫由 client 自行傳入 token。
- 不處理 token 過期重試邏輯；過期後需重新呼叫 `auth_token` / `member_token`。
