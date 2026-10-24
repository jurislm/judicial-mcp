# 對照腳本（parity）

把我方 judicial-mcp 和 [lawchat-oss/mcp-taiwan-legal-db](https://github.com/lawchat-oss/mcp-taiwan-legal-db)（固定在 `ef677ad`）用同一組查詢各跑一次，逐案判 PASS／FAIL。規格見 Linear JUR-814 與專案文件「產品規格｜獨立 Judicial MCP」的「品質基準怎麼比」。

這個目錄不打包進 npm（`package.json` 的 `files` 不含 `scripts/`），release-please 也用 `exclude-paths` 排除 `scripts`。腳本要連外網，所以不進 CI；CI 只跑 `__tests__/parity-compare.test.ts` 的比對規則單元測試。

## 手動執行

需要 `bun`、`git`、`uv`。在 repo 根目錄、要比對的 commit（通常是 main HEAD）上執行：

```bash
scripts/parity/run.sh
```

- 只跑部分案例：`scripts/parity/run.sh --cases Q1,Q2`
- 計時次數（預設 5）：`--rounds 5`
- 輸出目錄（預設 `parity-out/`，已列入 .gitignore）：`--out parity-out`
- 要量 Firecrawl 路徑時，先設 `FIRECRAWL_API_URL`；報表會記錄有沒有設。

`run.sh` 在暫存目錄抓對方 `ef677ad`、用 Python 3.12 建 venv（3.13 連司法院會出現 Missing Subject Key Identifier），uv 快取、Python、對方快取與 Chromium 都放在同一個暫存目錄，結束時（含失敗）整個刪掉。

請避開司法院與法務部公告的維護時段。全程只讀，每次工具呼叫之後至少間隔 1 秒。

## 流程

1. 冷快取第 1 輪：兩邊都重新啟動，刪掉對方的查詢快取 `legal_mcp.db`，全部案例各跑一次。我方沒有持久快取，重新啟動就是冷的。對方下載的法規代碼表與 Chromium 屬於安裝，不算快取，同一次執行內保留。
2. 熱快取：同一個 session 再把全部案例跑一次，計時案例再補到 5 次。
3. 冷快取第 2–5 輪：每輪重新啟動並刪對方查詢快取，只跑計時案例。

同一輪內，兩個案例的呼叫相同時只打一次。

## 判定

每個案例是 `cases.ts` 裡的一筆資料：我方工具與參數、對方工具與參數、一條比對規則。規則只有四種：

| 規則 | 意思 |
| -- | -- |
| `id_set` | 兩邊 id 集合的交集筆數 ≥ `min`；`min: 'all'` 表示集合相同；Q2 另設 `nonEmpty: true`，至少要有一筆非空識別碼。其他案例保留合法空集合相等 |
| `text_norm` | NFKC 正規化（全半形）並去掉全部空白後相同；陣列逐筆比。設 `similarity` 時改比字元相似度（PDF 用 0.98） |
| `field_presence` | 指定欄位兩邊都非空 |
| `field_equal` | 指定欄位正規化後相同（陣列照順序比） |

路徑寫法：`results[].jid` 取每筆的 jid，`results.0.jid` 取第一筆，`full_text#len` 取長度。

冷、熱兩輪都 PASS，且 `timingGate` 列出的階段符合「我方 5 次中位數 ≤ 對方 5 次中位數 × 1.5」，才算 PASS。雙方 transport／timeout 例外均判 ERROR；`isError` 本身不是 transport。來源 `source_unavailable` 判 ERROR；Q4 未設 Firecrawl 時，內容判定為預期 FAIL。對方其他工具錯誤由 `acceptError` 控制，未允許時判 ERROR。`timed: true` 的案例會記錄 5 次耗時；只有 `timingGate` 列出的階段會影響判定，其他只記錄。任一計時輪次呼叫失敗，該輪雙方耗時均不進中位數，JSON 保留失敗原因，Markdown 標 ERROR，整案 ERROR／exit 1（包含 Q4 未設 Firecrawl 而無法取得成功樣本的情況）。不足指定次數也不能通過。

| 判定 × 預期 | 結果 | exit code |
| -- | -- | -- |
| PASS × `pass` | 符合預期 | 0 |
| FAIL × `expected_fail` | 預期失敗 | 0 |
| FAIL × `pass` | 意外 FAIL | 1 |
| PASS × `expected_fail` | 意外 PASS，請把該案改成 `pass` | 1 |
| ERROR | 對方或連線失敗 | 1 |

還沒實作的工具標 `expected_fail`，不跳過。我方參數與欄位路徑是依各卡規格先寫的，實作那張卡要照實際輸出修正，並把案例改成 `pass`。

輸出 `parity-<台北時間>.json` 與 `.md`，含執行時間（台北時間）、兩邊 commit、每案冷熱判定、計時中位數，以及 Q1–Q5 的觀測值（筆數、首筆 jid、字數）。

## 尚未收進的案例

各卡驗收裡沒有指定具體查詢的項目，由實作那張卡挑定後再加：JUR-818 的民事、行政、刑事裁定各一筆；JUR-822 中英日期不同的法規與沒有英譯的命令；JUR-738 任選 3 件意見書；JUR-824 任選 3 份 PDF；JUR-739 停止適用的函釋與任選 5 個 id 的全文。JUR-739 的「模擬一個來源失敗」用 fixture 驗，不是對照案例。
