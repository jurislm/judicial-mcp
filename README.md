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
export JUDICIAL_USER=your_username
export JUDICIAL_PASSWORD=your_password
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

### 法規查詢錯誤排查

- `firecrawl_not_configured`：執行外掛的 MCP 程序沒有取得 `FIRECRAWL_API_URL`，或其值為空白。請將已部署的 Firecrawl 位址傳入實際啟動外掛的環境，再重新連線。終端、手動 MCP 設定與已啟動的外掛程序可能使用不同環境；獨立程序成功不代表聊天掛載的外掛已恢復。
- `firecrawl_invalid_configuration`：Firecrawl 位址必須為 HTTP(S)，不得包含帳密、查詢參數或 fragment；傳送 API key 到非 loopback 主機時必須使用 HTTPS。錯誤回應不會包含設定值或金鑰。
- `source_unavailable`：法規名稱查詢或已設定的 Firecrawl 抓取失敗，不能只憑此代碼判定法務部網站故障。

設定後，在同一聊天掛載的外掛執行 `query_regulation`，指定 `lawName="民法"`、`articleNumber="184"`、`refresh=true`，核對條文、官方來源與 `article_effectiveness`。不要以快取結果或獨立程序的成功取代外掛驗收。

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

### 固定安裝的桌面啟動器

若桌面啟動不能依賴 npm registry 或可清除的 bunx 暫存，可將已核准版本固定安裝在 `$HOME/.local/share/jurislm/mcp/judicial-mcp`。安裝與更新是明確的獨立步驟，不在 MCP handshake 期間執行。

```sh
runtime="$HOME/.local/share/jurislm/mcp/judicial-mcp"
mkdir -p "$runtime"
cd "$runtime"
bun add --exact --ignore-scripts @jurislm/judicial-mcp@<核准版本>
```

保留此目錄的 `package.json`、`bun.lock` 及完整 `node_modules`。`package.json` 的精確版本是唯一版本選擇來源；啟動器核對 lock 與安裝版身分，不接受 `latest` 或範圍版本。離線重建可使用 `bun install --offline --frozen-lockfile --ignore-scripts`，快取不完整時會失敗，不會改用其他 registry。更新前保留原安裝，更新後先驗證 initialize 的 `serverInfo` 與工具目錄，再切換正式設定。

將本 repository 的 `launchers/judicial-desktop.mjs` 複製到桌面啟動器位置，例如 `$HOME/.codex/bin/judicial-desktop.mjs`。在 MCP 設定中使用 Bun 的絕對路徑，參數為 `--no-env-file` 與啟動器的絕對路徑；以 `JUDICIAL_ENV_FILE` 指定原有憑證檔的絕對路徑。不要複製憑證到 runtime、設定檔或命令列。

此啟動器專供需要帳密的連線：檔案必須同時包含 `JUDICIAL_USER`（或既有別名 `JUDICIAL_USERNAME`）及 `JUDICIAL_PASSWORD`，兩個帳號鍵並存時必須相同。檔案只以 dotenv 解析，不會執行 shell 或展開 `$`。僅兩個憑證鍵進入 MCP 環境；原檔不會改寫。保留的父環境僅有 `HOME`、`PATH`、`TMPDIR`、`LANG`、`LC_ALL`、`TZ` 與既有 `FIRECRAWL_API_URL`，不繼承其他憑證或自動載入 cwd 的 `.env`。此方式不變更其他 MCP 的 required、approval 或排程。

缺少安裝、lock、entry 或憑證時會快速失敗，stderr 只輸出不含秘密的錯誤，stdout 留給 MCP。這不取代安裝後的隔離 initialize、正式掛載及授權窗口內的 JDoc 驗收；不需要帳密的公開工具可維持既有啟動方式。
