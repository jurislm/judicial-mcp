# Copilot Instructions

## 語言與執行環境
- 此專案使用 Node.js（CommonJS，`require`/`module.exports`），不使用 TypeScript 或 ESM
- 不建議使用 `import`/`export` 語法
- 此為台灣司法院公開資料的 MCP Server

## 程式碼風格
- 預設使用 `const`；僅在需要重新賦值時使用 `let`，不使用 `var`
- 非同步函式統一使用 `async/await`，避免 `.then()` chain
- 下劃線前綴（`_param`）表示刻意不使用的參數，ESLint 允許此模式

## 測試
- 測試框架為 Jest，新功能必須附帶單元測試
- 不建議使用 Vitest 特有 API（如 `vi.fn()`），統一使用 `jest.fn()`

## Code Review 重點
- 標記任何 `eval()` 或 `new Function()` 使用為安全疑慮
- 用戶輸入直接拼接到字串中（潛在 injection）需標記
- `async` 函式缺少 try/catch 或 `.catch()` 需提醒（unhandled rejection 風險）
- 日期格式驗證需特別注意（司法院資料的日期格式多變）

## 忽略範圍
- 不審查 `node_modules/`、`dist/`、`coverage/` 目錄下的檔案
- 不對自動生成的 mock 檔案提出風格建議
