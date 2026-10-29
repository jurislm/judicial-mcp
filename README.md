# @jurislm/judicial-mcp

台灣裁判與法規查詢 MCP 伺服器，提供 10 個工具。工具清單可直接讀取，不需登入。

## 安裝

需要 Bun 1.3.14 以上版本，並確保 Codex 可在 `PATH` 找到 `bun`。

```bash
codex plugin marketplace add jurislm/judicial-mcp
codex plugin add judicial-mcp@judicial-marketplace
```

外掛會自行註冊 MCP，請勿再新增重複的 `judicial` MCP 設定。更新後重新啟動外掛。

## 工具

MCP 用戶端可以列出全部工具，不需登入。依工具取得資料所需的條件如下。

### 不需司法院登入

- `search_judgments`：搜尋司法院公開裁判。
- `fetch_judgment_text`：依 `case_id` 取得裁判全文。
- `query_regulation`：查詢法規條文與單條生效資訊，需設定 Firecrawl 服務。

### 需司法院登入

先在 Codex 啟動環境設定帳密；`auth_token` 和 `member_token` 會讀取這兩個環境變數：

```bash
JUDICIAL_USER=your_username
JUDICIAL_PASSWORD=your_password
```

- `auth_token`：以司法院帳密取得裁判書 API Token。
- `member_token`：以司法院帳密取得開放資料平台 Token。
- `list_judgments`：使用裁判書 Token 查詢裁判書異動清單。
- `get_judgment`：使用裁判書 Token 與 JID 取得裁判書。
- `list_categories`：使用會員 Token 列出開放資料分類。
- `list_resources`：使用會員 Token 與分類編號列出資料來源。
- `download_file`：使用會員 Token 與檔案集 ID 下載資料，支援分頁。

`query_regulation` 回傳最新公布條文；最新公布版本不一定已生效。生效狀態包含官方依據，資料不足時回傳 `unknown`。

## Firecrawl 設定

`query_regulation` 需要可用的 Firecrawl 服務。使用本機 Docker 服務時，從已設定環境變數的終端啟動 Codex：

```bash
FIRECRAWL_API_URL=http://127.0.0.1:3002 codex
```

若 Firecrawl 服務要求金鑰，再設定 `FIRECRAWL_API_KEY`。司法院帳密是選填，只供其他帳號授權工具使用。請勿將金鑰寫入外掛設定或提交環境檔。

## 移除

```bash
codex plugin remove judicial-mcp@judicial-marketplace
codex plugin marketplace remove judicial-marketplace
```

## 開發

```bash
bun install --frozen-lockfile
bun run test
bun run lint
bun run typecheck
bun run build:types
```

## 授權

MIT
