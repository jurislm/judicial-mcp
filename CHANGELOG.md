# Changelog

## [1.5.0](https://github.com/jurislm/judicial-mcp/compare/v1.4.0...v1.5.0) (2026-05-05)


### Features

* add automated version management system ([2ed28e7](https://github.com/jurislm/judicial-mcp/commit/2ed28e74e3ce0e9d5b50fee4b62238b240de274a))
* **ci:** add CI workflow and update code review prompt ([83b8e0e](https://github.com/jurislm/judicial-mcp/commit/83b8e0ebb60fe8e75bcb5bdede8032006a2a7831))
* MCP spec compliance — isError, pure JSON responses, SDK 1.x, 7 tools ([7abdb72](https://github.com/jurislm/judicial-mcp/commit/7abdb723ca012c2d1ffad424084ca8ad7f173390))
* migrate to TypeScript + Vitest + ESM ([c6321d2](https://github.com/jurislm/judicial-mcp/commit/c6321d28aba98b036ae53c97e7370ddad77503cd))
* v1.4.0 MCP spec compliance — security, protocol, schema fixes ([6d7eb64](https://github.com/jurislm/judicial-mcp/commit/6d7eb64615db3940247d250a9ff8c45a60ea1b26))
* v1.4.0 MCP spec compliance fixes ([#1](https://github.com/jurislm/judicial-mcp/issues/1)) ([984c011](https://github.com/jurislm/judicial-mcp/commit/984c011eec3dc3448579e529d82b074969fdb1d4))
* 刪除 CLAUDE.md 文件，移除不再需要的文檔 ([b7aea73](https://github.com/jurislm/judicial-mcp/commit/b7aea738e75a21c8838b6937524797a87a4811a0))
* 刪除設定檔 settings.local.json，更新 .gitignore 以排除 .claude 目錄 ([8958aa0](https://github.com/jurislm/judicial-mcp/commit/8958aa089b86ff07383b243e43e5c34c3afd8af0))
* 擴充 Bash 命令至設定檔，新增會員授權 Token 取得功能，更新 README.md 環境變數說明 ([f95f614](https://github.com/jurislm/judicial-mcp/commit/f95f614d119949446a3742f4cce68f8b819c2566))
* 新增 .env.example 檔案，包含伺服器設定與帳號資訊；更新 mcp-client-example.js 以簡化錯誤處理；更新 package.json 增加 TypeScript 支援與測試覆蓋率腳本；在 index.js 中增加錯誤日誌；擴充 tools.js 以加入輸入驗證功能；新增 TypeScript 類型定義檔案 index.d.ts ([ae81062](https://github.com/jurislm/judicial-mcp/commit/ae81062154d9458846b501b49f91f76aa6aa3a0f))
* 新增 Bash 命令至設定檔，擴充允許的操作列表，更新 README.md 以提供 MCP 客戶端配置範例 ([01b5430](https://github.com/jurislm/judicial-mcp/commit/01b5430b0c59afb86fcc43cf5bd7aa69eba0b323))
* 新增會員授權 Token 驗證至工具配置，更新 API 調用以支援授權 ([3e27806](https://github.com/jurislm/judicial-mcp/commit/3e27806ea44345180b6e38d4858fad589f8a28a4))
* 更新 .gitignore，新增 .mcp.json 檔案排除 ([47c155f](https://github.com/jurislm/judicial-mcp/commit/47c155f31fef509da1ff2efb54e035b5946f8900))
* 更新 .gitignore，新增 CLAUDE.md 檔案排除 ([7bd7c97](https://github.com/jurislm/judicial-mcp/commit/7bd7c9731a29e90da913888838b3a510c5490c01))
* 更新 CHANGELOG.md，新增 1.2.0 版本的功能與改進；更新 package.json 版本號至 1.2.0；在 README.md 中新增測試覆蓋率執行說明 ([1afc80b](https://github.com/jurislm/judicial-mcp/commit/1afc80b32116fa2c07d96e3d1ae13819fd924f49))
* 更新 CLAUDE.md，修正工具數量，新增會員授權 Token 功能說明 ([6f468d6](https://github.com/jurislm/judicial-mcp/commit/6f468d65537c10e70aa80e2e4b0129c73cb33a93))
* 更新 README.md，新增行為準則、授權條款及 MCP 使用教學文件 ([e0e562f](https://github.com/jurislm/judicial-mcp/commit/e0e562f0b0eff8a2ade18904aec9b3a183478678))
* 更新伺服器版本至 1.2.2 ([10d9562](https://github.com/jurislm/judicial-mcp/commit/10d956215bc526de281c7d8c8e587d00917b7f2f))
* 更新工具配置以支援會員授權 Token，調整相關測試用例 ([a8f05bd](https://github.com/jurislm/judicial-mcp/commit/a8f05bdf32df856f3b1d4125f9bbfb1f54aedf43))
* 更新版本號至 1.1.0，新增 CHANGELOG.md 檔案以記錄變更 ([dc204a6](https://github.com/jurislm/judicial-mcp/commit/dc204a61b2b92f1136dbdf714d220294aee08592))
* 移除 index.js 中的授權資訊註解 ([4aee235](https://github.com/jurislm/judicial-mcp/commit/4aee235d6a7e7177c8168b303b35c603c93c8ffa))
* 移除多個檔案中的作者與版本註解，簡化文件內容 ([417fc2d](https://github.com/jurislm/judicial-mcp/commit/417fc2d811015bd1580cc73644b7706974225b37))
* 移除自動更新版本號的腳本，簡化版本管理流程 ([fdd58a7](https://github.com/jurislm/judicial-mcp/commit/fdd58a7fc0df27a8dccdeb0392040527db8e4c00))
* 隱藏 dotenv 輸出至控制台，優化錯誤處理，移除啟動訊息 ([5cd0970](https://github.com/jurislm/judicial-mcp/commit/5cd097032d266daf24fc73708db198244acb8a0f))


### Bug Fixes

* 修正 package.json 中的關鍵字大小寫，統一為小寫 ([3be6178](https://github.com/jurislm/judicial-mcp/commit/3be6178b547bdd698ad3dc1c50ce5518311d0102))
* 無法成功取得【開放平台】的會員授權 Token ([b36c14f](https://github.com/jurislm/judicial-mcp/commit/b36c14fb14c5d1733f8636d53c981d490093503a))


### Documentation

* add CLAUDE.md with architecture overview and dev commands ([44f9fa6](https://github.com/jurislm/judicial-mcp/commit/44f9fa620665c670021749bc75c6a2797bc9f872))
* add CLAUDE.md with architecture overview and dev commands ([43a7574](https://github.com/jurislm/judicial-mcp/commit/43a7574ca1d17dbc8937fe200c8958ba669181e9))
* add copilot instructions (Node.js/CJS MCP template) ([310193d](https://github.com/jurislm/judicial-mcp/commit/310193d16edcf1265708c7e44061ea670791db9e))
* add openspec config and full spec suite for all 7 MCP tools ([2078cad](https://github.com/jurislm/judicial-mcp/commit/2078cada4bbf84ce5eaf9ffebdb703714938e5a2))
* add openspec config and full spec suite for all 7 MCP tools ([39052fb](https://github.com/jurislm/judicial-mcp/commit/39052fbc86bb83d25ca4e628152881477a70e988))
* update copilot-instructions with judicial-mcp specific context ([cd67a1e](https://github.com/jurislm/judicial-mcp/commit/cd67a1e085fb58f64d0610da545ac4ce5d797ec8))
* 精簡 MCP_TUTORIAL.md 並修正工具分類 ([2ba8780](https://github.com/jurislm/judicial-mcp/commit/2ba878006a7d9257d280a49b927c1e64d6d84937))

## [1.2.1] - 2025-07-23
### 改進
- 達成 100% 測試覆蓋率 (46 tests, 278 lines covered)
- 移除未使用的 Express 伺服器相關檔案和依賴
- 修正所有 oxlint 警告，提升程式碼品質
- 增強 MCP 配置測試，包含所有 7 個工具的完整驗證
- 新增工具架構安全性驗證 (`additionalProperties: false`)

### 移除
- 刪除 `server.js`, `start.js` 及相關測試檔案
- 清理 62 個未使用的 npm 套件依賴
- 移除 Express.js 和 HTTP API 相關程式碼

---

## [1.2.0] - 2025-07-22
### 新增
- TypeScript 類型定義檔案 (`types/index.d.ts`)
- 輸入驗證功能
- 測試覆蓋率腳本 (`test:coverage`)
- 環境變數範例檔案 (`.env.example`)

### 改進
- 強化錯誤處理和日誌記錄
- 新增 API 參數驗證機制

---

## [1.1.1] - 2025-07-10
### 修復
- 修正版本號不一致的問題
- 同步所有文件中的版本資訊

### 改進
- 優化專案版本管理流程

---

## [1.1.0] - 2025-07-02
### 新增
- 增加對 `list_resources` 工具的完整支持，允許用戶根據分類編號檢索資料源。
- 完善 `download_file` 工具，支持分頁參數 `top` 和 `skip`。

### 改進
- 優化 `auth_token` 工具的錯誤處理，提供更詳細的錯誤信息。
- 更新測試覆蓋率，新增對 `list_resources` 和 `download_file` 工具的測試用例。
- 改善 `README.md` 文檔，新增對新功能的使用說明。

### 修復
- 修正 `get_judgment` 工具在處理無效裁判書 ID 時的錯誤回應。
- 修復環境變數未正確加載時的潛在問題。

---

## [1.0.0] - 2025-06-30
### ✨ 主要功能

- 🏛️ **司法院裁判書 API** - 取得裁判書授權、清單和內容
- 📊 **開放資料 API** - 存取司法院開放資料平台
- 🔍 **分類資料** - 瀏覽主題分類和資料源
- 📥 **檔案下載** - 下載司法資料檔案
- 🧪 **完整測試** - Jest 測試覆蓋
- 🔒 **安全認證** - 支援 Token 基礎認證
- 📖 **完整文檔** - 詳細的 API 文檔和使用範例
- ⚡ **高效能** - 基於 Express.js 框架，支援非同步處理
