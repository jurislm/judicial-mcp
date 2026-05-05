// MCP 使用 stdio transport，stdout 只能輸出 JSON-RPC 訊息。
// 覆寫必須在所有 import 模組初始化之前生效。
// ESM static import 會被 hoist 至頂層程式碼之前執行，因此這裡不放任何 static import，
// 改用 dynamic import 確保覆寫先於所有依賴模組的初始化。
console.log = console.info = console.warn = (...args: unknown[]) =>
  process.stderr.write(args.join(' ') + '\n')

await import('./server.js')

export {}
