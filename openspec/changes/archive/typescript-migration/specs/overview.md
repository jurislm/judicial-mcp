# Spec Delta — overview.md（MODIFIED）

> 本檔為 `typescript-migration` change 對 `openspec/specs/overview.md` 的修改版。
> 此 change 無工具行為變更（見 proposal.md「Non-goals」），唯一的 spec 影響為架構描述：
> 來源檔由 `.js`（CommonJS）改為 `.ts`（ESM, strict），`index.js` 拆為 `index.ts` + `server.ts`，
> CLI 改為 Bun-native（無 npx）。下方為套用此 change 後 overview.md 應呈現的內容。

---

# judicial-mcp — Server Overview

## Purpose

`@jurislm/judicial-mcp` 是一個 MCP（Model Context Protocol）Server，以 stdio transport 運行，
提供 7 個工具供 MCP client（如 Claude Code）透過自然語言存取台灣司法院的裁判書查詢系統
與開放資料平台。

## Architecture

```text
src/index.ts          — Bootstrap：先覆寫 console.* → stderr，再 dynamic import('./server.js')
src/server.ts         — MCP Server 主程式（啟動、工具路由、協議錯誤處理、stdio transport）
src/tools.ts          — TOOLS_CONFIG（工具定義）+ TOOL_HANDLERS（工具執行器）+ validateInput + apiErrorMessage
src/response.ts       — MCP CallToolResult 格式化工具函式（含型別 McpToolResult / ContentBlock）
bin/judicial-mcp.ts   — CLI 入口點（Bun-native，#!/usr/bin/env bun；無 npx 支援）
types/                — 自動產生的 .d.ts（tsc --emitDeclarationOnly，gitignored）
```

執行環境為 Bun（>=1.1.0），原始碼為 TypeScript（ESM, strict mode），由 Bun 直接執行 `.ts`，
無建置步驟。進程環境變數：`JUDICIAL_USER`、`JUDICIAL_PASSWORD`（兩套 API 共用同一組帳密）。

> 為何拆 `index.ts` / `server.ts`：MCP stdio transport 要求 stdout 僅輸出 JSON-RPC，
> `console.*` 必須在任何依賴模組初始化「之前」被改寫至 stderr。ESM 的 static import 會 hoist
> 至頂層程式碼之前執行，故 `index.ts` 只做 console 覆寫後以 dynamic import 載入 `server.ts`，
> 確保覆寫先於 SDK／工具模組的初始化。

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
| `auth_token` | Authentication | 無 | `src/tools.ts:147` |
| `member_token` | Authentication | 無 | `src/tools.ts:241` |
| `list_judgments` | Judgments | `auth_token` | `src/tools.ts:163` |
| `get_judgment` | Judgments | `auth_token` | `src/tools.ts:175` |
| `list_categories` | Open Data | `member_token` | `src/tools.ts:190` |
| `list_resources` | Open Data | `member_token` | `src/tools.ts:204` |
| `download_file` | Open Data | `member_token` | `src/tools.ts:219` |

## Typical Call Flows

**裁判書查詢**
```text
auth_token → list_judgments → get_judgment(jid)
```

**開放資料下載**
```text
member_token → list_categories → list_resources(categoryNo) → download_file(fileSetId)
```

## Non-goals

- 不提供 HTTP REST API；僅支援 stdio MCP transport。
- 不快取 token；每次工具呼叫由 client 自行傳入 token。
- 不處理 token 過期重試邏輯；過期後需重新呼叫 `auth_token` / `member_token`。
- 不提供 npx 執行；僅支援 Bun（`bunx @jurislm/judicial-mcp`）。
