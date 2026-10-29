# 單條條文版本生效判斷

Terry 已於本次對話批准依官方沿革、施行說明實作與發布。免 Token，保留現有法規級 version，新增 article_effectiveness。判斷對象是 article_text 的最新公布整編版本，非案件適用法律。

article_effectiveness 包含 status（effective、not_yet_effective、unknown）、effective_date（可空）、reason、basis（官方來源URL與原文節錄）、checked_at。來源不足、未支援的條件、分項施行、另定日期但無明確待施行警示、矛盾資料一律 unknown。日期以臺灣當日比較，cache不得跨日沿用判斷。

官方 LawHistory 頁為第二個來源，核對同一法規名稱、版本日期後，追查最新涉及查詢條號的修正/增訂紀錄，處理數字清單及區間；明確的全條施行日期可判斷。「自公布日施行」涉及中央法規標準法第13條第三日起生效的規則，本版不套用一般日曆推算，回傳unknown。相對月數須以完整公布日期及明確語法計算，月底須正確處理，無法無歧義計算時unknown。完整的 #VaildState/law-vaildMemo 警示針對所查條號優先；不得用未被點名當作有效證據。

最新版本未生效時，article_text明確標為latest_promulgated，article_effectiveness為not_yet_effective；目前有效舊文不從LawOldVer推定，提供限制說明，使用者不得把它當現行有效內容。法規級partial與version維持原有語意，工具描述與README說明新欄位。

不實作任意歷史日期查詢、所有法律施行語法、模型推論或歷史文字自動補齊。最小完整交付包含民法184/166-1/1223與未知/來源失敗/邊界測試、公開來源實測及npm發版。
