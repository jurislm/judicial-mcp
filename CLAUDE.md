# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 指令速查

```bash
# 型別檢查
bun run typecheck             # tsc --noEmit（strict 模式）

# 測試（使用 Vitest）
bun run test                  # 執行所有測試
bun run test:watch            # 監聽模式
bun run test:coverage         # 含覆蓋率報告
bun run test -- --reporter=verbose  # 詳細輸出

# Lint
bun run lint                  # 檢查（max-warnings=0）
bun run lint:fix              # 自動修復

# 執行 MCP server（stdio transport，供本地測試用）
bun run start

# 生成型別宣告（publish 前自動執行）
bun run build:types
```

**注意**：`bun test` 會用 Bun 內建 runner（不相容），必須用 `bun run test`（呼叫 Vitest）。

## 架構概觀

這是一個 TypeScript ESM MCP Server，透過 **stdio transport** 與 MCP client 通訊。只有 3 個核心模組：

```
src/
  index.ts    — MCP Server 入口，註冊 ListTools / CallTool 兩個 handler
  tools.ts    — 所有工具定義（TOOLS_CONFIG）與執行器（TOOL_HANDLERS）
  response.ts — MCP 回應格式工具（success / error / blob）
```

### 兩套上游 API

| 工具群 | Token 來源 | 端點 |
|--------|-----------|------|
| 裁判書（auth_token / list_judgments / get_judgment） | `JUDICIAL_API_BASE` (`data.judicial.gov.tw/jdg/api`) | POST |
| 開放資料（member_token / list_categories / list_resources / download_file） | `OPENDATA_API_BASE` (`opendata.judicial.gov.tw`) | GET + Bearer header |

認證憑據從環境變數 `JUDICIAL_USER` / `JUDICIAL_PASSWORD` 讀取，Server 本身不接受外部傳入。

### stdout 限制

MCP 使用 stdio transport，**stdout 只能輸出 JSON-RPC 訊息**。`index.ts` 在最頂層將 `console.log / info / warn` 全數重定向至 `stderr`。新增 debug log 必須用 `console.error` 或寫到 stderr。

### download_file 的特殊回傳格式

其他 6 個 handler 回傳原始資料，由 `index.ts` 統一包成 `createSuccessResponse`。`download_file` 例外：直接回傳 `createBlobResponse`（MCP resource content type，含 base64 blob），`index.ts` 偵測到 `result.content` 是陣列時不再二次包裝。

## 測試架構

測試全部位於 `__tests__/`，使用 Vitest + `vi.mock('axios')`。所有 HTTP 呼叫都被 mock，測試不需要實際網路連線或有效帳密。

環境變數在 `beforeEach` 設置、`afterEach` 清除。

## 環境變數

```bash
JUDICIAL_USER=your_username
JUDICIAL_PASSWORD=your_password
```

這兩個環境變數若放在 `.env` 檔，會由 `dotenv` 自動載入。若透過 MCP client（如 Claude Code）執行，建議寫入 `~/.zshenv`。

## 新增工具的標準流程

1. 在 `src/tools.ts` 的 `TOOLS_CONFIG` 新增工具定義（inputSchema 必須含 `additionalProperties: false`）
2. 在 `TOOL_HANDLERS` 前先定義 `interface XxxArgs { ... }`
3. 在同檔案的 `TOOL_HANDLERS` 新增對應的 async 函數，`catch` 一律用 `apiErrorMessage(error)` 收窄
4. 呼叫 `validateInput.required()` 驗證必要參數，呼叫 `validateInput.token()` 驗證 token 格式
5. 在 `__tests__/tools.test.ts` 補測試（成功路徑 + 各錯誤路徑）
