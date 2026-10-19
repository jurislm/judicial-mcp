import type { Call, ParityCase, Rule } from './compare.js'

const Q1_KEYWORD = '預售屋 遲延交屋'
const Q5_CASE = 'TPSM,114,台上,3753,20251112,1'

const q1Ours: Call = { tool: 'search_judgments', args: { keyword: Q1_KEYWORD, limit: 5 }, observe: { count: 'count', first: 'results.0.case_id', next_page: 'next_page', next_offset: 'next_offset', truncated: 'truncated' } }
const q1Theirs: Call = { tool: 'search_judgments', args: { keyword: Q1_KEYWORD, max_results: 5 }, observe: { count: 'total_count', first: 'results.0.jid' } }
const q1TwentyOurs: Call = { tool: 'search_judgments', args: { keyword: Q1_KEYWORD, limit: 20 } }
const q1TwentyTheirs: Call = { tool: 'search_judgments', args: { keyword: Q1_KEYWORD, max_results: 20 } }
const q5Ours: Call = { tool: 'fetch_judgment_text', args: { caseId: Q5_CASE }, observe: { full_text_chars: 'full_text#len' } }
const q5Theirs: Call = { tool: 'get_judgment', args: { jid: Q5_CASE }, observe: { full_text_chars: 'full_text#len', reasoning_chars: 'reasoning#len', judges: 'judges#len', cited_statutes: 'cited_statutes#len', history: 'history#len' } }

const regulation = (lawName: string, extra: Record<string, unknown> = {}, theirsExtra: Record<string, unknown> = {}) => ({
  ours: { tool: 'query_regulation', args: { lawName, ...extra } },
  theirs: { tool: 'query_regulation', args: { law_name: lawName, ...theirsExtra } },
})

const same = (tool: string, ours: Record<string, unknown>, theirs: Record<string, unknown>) => ({
  ours: { tool, args: ours },
  theirs: { tool, args: theirs },
})

const xf = (id: string, card: string, title: string, calls: { ours: Call; theirs: Call & { acceptError?: boolean } }, rule: Rule): ParityCase => ({
  id, card, title, ...calls, rule, expect: 'expected_fail',
})

const interpretationFields = (key: string, caseId: string, issuesField: string): ParityCase[] =>
  (['case_number', 'date', issuesField, 'main_text'] as const).map((field) =>
    xf(`C-${key}-${field}`, 'JUR-738', `${caseId} 預設層 ${field}`, same('get_interpretation', { caseId }, { case_id: caseId }), { kind: 'text_norm', ours: field, theirs: field }))

export const CASES: ParityCase[] = [
  { id: 'Q1', card: 'JUR-817', title: 'Q1 判決搜尋「預售屋 遲延交屋」各 5 筆 jid 全同', ours: q1Ours, theirs: q1Theirs, rule: { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].jid', min: 5 }, expect: 'expected_fail', timed: true },
  xf('Q1-court_level', 'JUR-817', 'Q1 前 5 筆 court_level 順序相同', { ours: q1Ours, theirs: q1Theirs }, { kind: 'field_equal', ours: 'results[].court_level', theirs: 'results[].court_level' }),
  xf('Q1-20', 'JUR-817', 'Q1 各取 20 筆，jid 交集 ≥ 18', { ours: q1TwentyOurs, theirs: q1TwentyTheirs }, { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].jid', min: 18 }),
  {
    id: 'Q2', card: 'JUR-817', title: 'Q2 案號查詢 最高法院 114 台上 3753',
    ours: { tool: 'search_judgments', args: { court: '最高法院', year: 114, caseNumber: '114年度台上字第3753號' }, observe: { count: 'count', ambiguous: 'ambiguous' } },
    theirs: { tool: 'search_judgments', args: { court: '最高法院', year_from: 114, case_word: '台上', case_number: '3753' }, observe: { count: 'total_count' } },
    rule: { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].jid', min: 'all' }, expect: 'pass', timed: true,
  },
  xf('J-main_text', 'JUR-817', '「預售屋 遲延交屋」＋主文「原告之訴駁回」各 20 筆，交集 ≥ 18',
    same('search_judgments', { keyword: Q1_KEYWORD, mainText: '原告之訴駁回', limit: 20 }, { keyword: Q1_KEYWORD, main_text: '原告之訴駁回', max_results: 20 }),
    { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].jid', min: 18 }),
  xf('J-criminal-112-113', 'JUR-817', '刑事 112–113 年「詐欺 車手」各 20 筆，交集 ≥ 18',
    same('search_judgments', { keyword: '詐欺 車手', caseType: '刑事', yearFrom: 112, yearTo: 113, limit: 20 }, { keyword: '詐欺 車手', case_type: '刑事', year_from: 112, year_to: 113, max_results: 20 }),
    { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].jid', min: 18 }),

  { id: 'Q5-main_text', card: 'JUR-818', title: 'Q5 全文 main_text', ours: q5Ours, theirs: q5Theirs, rule: { kind: 'text_norm', ours: 'main_text', theirs: 'main_text' }, expect: 'expected_fail', timed: true },
  xf('Q5-reasoning', 'JUR-818', 'Q5 全文 reasoning', { ours: q5Ours, theirs: q5Theirs }, { kind: 'text_norm', ours: 'reasoning', theirs: 'reasoning' }),
  xf('Q5-judges', 'JUR-818', 'Q5 法官名單', { ours: q5Ours, theirs: q5Theirs }, { kind: 'id_set', ours: 'judges', theirs: 'judges', min: 'all' }),
  xf('Q5-cited_statutes', 'JUR-818', 'Q5 引用法條集合', { ours: q5Ours, theirs: q5Theirs }, { kind: 'id_set', ours: 'cited_statutes', theirs: 'cited_statutes', min: 'all' }),

  {
    id: 'Q3', card: 'JUR-816', title: 'Q3 勞基法第 24 條條文',
    ours: { tool: 'query_regulation', args: { lawName: '勞基法', articleNumber: '24' }, observe: { status: 'status', candidates: 'candidates[].regulation_id' } },
    theirs: { tool: 'query_regulation', args: { law_name: '勞基法', article_no: '24' }, observe: { pcode: 'law.pcode', last_amended: 'law.last_amended' } },
    rule: { kind: 'text_norm', ours: 'article_text', theirs: 'articles[].content' }, expect: 'expected_fail', timed: true,
  },
  xf('Q3-last_amended', 'JUR-816', 'Q3 last_amended', regulation('勞基法', { articleNumber: '24' }, { article_no: '24' }), { kind: 'field_equal', ours: 'law.last_amended', theirs: 'law.last_amended' }),
  {
    id: 'Q4', card: 'JUR-814', title: 'Q4 民法第 184 條條文與耗時',
    ours: { tool: 'query_regulation', args: { lawName: '民法', articleNumber: '184' }, observe: { status: 'status', error: 'error.code' } },
    theirs: { tool: 'query_regulation', args: { law_name: '民法', article_no: '184' }, observe: { last_amended: 'law.last_amended' } },
    rule: { kind: 'text_norm', ours: 'article_text', theirs: 'articles[].content' }, expect: 'expected_fail', timed: true, timingGate: ['cold', 'warm'],
  },

  xf('P-消保法-pcode', 'JUR-816', 'get_pcode「消保法」pcode', same('get_pcode', { lawName: '消保法' }, { law_name: '消保法' }), { kind: 'field_equal', ours: 'pcode', theirs: 'pcode' }),
  xf('P-消保法-status', 'JUR-816', 'get_pcode「消保法」status', same('get_pcode', { lawName: '消保法' }, { law_name: '消保法' }), { kind: 'field_equal', ours: 'status', theirs: 'status' }),
  xf('P-民法-pcode', 'JUR-816', 'get_pcode「民法」pcode', same('get_pcode', { lawName: '民法' }, { law_name: '民法' }), { kind: 'field_equal', ours: 'pcode', theirs: 'pcode' }),
  xf('P-民法-status', 'JUR-816', 'get_pcode「民法」status', same('get_pcode', { lawName: '民法' }, { law_name: '民法' }), { kind: 'field_equal', ours: 'status', theirs: 'status' }),
  xf('P-不存在的法', 'JUR-816', 'get_pcode「不存在的法」建議集合', { ours: { tool: 'get_pcode', args: { lawName: '不存在的法' } }, theirs: { tool: 'get_pcode', args: { law_name: '不存在的法' }, acceptError: true } }, { kind: 'id_set', ours: 'suggestions', theirs: 'suggestions', min: 'all' }),
  xf('S-勞動-total', 'JUR-816', 'search_regulations「勞動」total_count', same('search_regulations', { keyword: '勞動' }, { keyword: '勞動' }), { kind: 'field_equal', ours: 'total_count', theirs: 'total_count' }),
  xf('S-勞動-pcodes', 'JUR-816', 'search_regulations「勞動」第 1 頁 pcode 集合', same('search_regulations', { keyword: '勞動' }, { keyword: '勞動' }), { kind: 'id_set', ours: 'results[].pcode', theirs: 'results[].pcode', min: 'all' }),
  xf('S-amended_since-total', 'JUR-816', 'search_regulations amended_since 2026-09-01 total_count', same('search_regulations', { amendedSince: '2026-09-01' }, { amended_since: '2026-09-01' }), { kind: 'field_equal', ours: 'total_count', theirs: 'total_count' }),
  xf('S-amended_since-pcodes', 'JUR-816', 'search_regulations amended_since 2026-09-01 pcode 集合', same('search_regulations', { amendedSince: '2026-09-01' }, { amended_since: '2026-09-01' }), { kind: 'id_set', ours: 'results[].pcode', theirs: 'results[].pcode', min: 'all' }),
  xf('S-金管會-total', 'JUR-816', 'search_regulations category 金融監督管理委員會 total_count', same('search_regulations', { category: '金融監督管理委員會' }, { category: '金融監督管理委員會' }), { kind: 'field_equal', ours: 'total_count', theirs: 'total_count' }),
  xf('S-金管會-pcodes', 'JUR-816', 'search_regulations category 金融監督管理委員會 pcode 集合', same('search_regulations', { category: '金融監督管理委員會' }, { category: '金融監督管理委員會' }), { kind: 'id_set', ours: 'results[].pcode', theirs: 'results[].pcode', min: 'all' }),

  xf('R-184~198', 'JUR-820', '民法 184~198 逐條條文', regulation('民法', { articleNumber: '184~198' }, { article_no: '184~198' }), { kind: 'text_norm', ours: 'articles[].content', theirs: 'articles[].content' }),
  xf('R-1~60', 'JUR-820', '民法 1~60 回 50 條、續查起點相同', regulation('民法', { articleNumber: '1~60' }, { article_no: '1~60' }), { kind: 'field_equal', ours: 'articles[].number', theirs: 'articles[].number' }),
  xf('R-184,9999-missing', 'JUR-820', '民法 184,9999 missing', regulation('民法', { articleNumber: '184,9999' }, { article_no: '184,9999' }), { kind: 'field_equal', ours: 'missing', theirs: 'missing' }),
  xf('R-184,9999-text', 'JUR-820', '民法 184,9999 的 184 條文', regulation('民法', { articleNumber: '184,9999' }, { article_no: '184,9999' }), { kind: 'text_norm', ours: 'articles[].content', theirs: 'articles[].content' }),
  xf('R-勞基法-structure-title', 'JUR-820', '勞動基準法目錄標題', regulation('勞動基準法'), { kind: 'field_equal', ours: 'structure[].title', theirs: 'structure[].title' }),
  xf('R-勞基法-structure-first', 'JUR-820', '勞動基準法目錄起始條號', regulation('勞動基準法'), { kind: 'field_equal', ours: 'structure[].first_article', theirs: 'structure[].first_article' }),

  xf('H-民法184-dates', 'JUR-821', '民法第 184 條歷次版本日期', regulation('民法', { articleNumber: '184', includeHistory: true }, { article_no: '184', include_history: true }), { kind: 'field_equal', ours: 'article_history.versions[].date', theirs: 'article_history.revisions[].date' }),
  xf('H-民法184-text', 'JUR-821', '民法第 184 條歷次版本條文', regulation('民法', { articleNumber: '184', includeHistory: true }, { article_no: '184', include_history: true }), { kind: 'text_norm', ours: 'article_history.versions[].text', theirs: 'article_history.revisions[].content' }),
  xf('H-勞基法24-dates', 'JUR-821', '勞動基準法第 24 條歷次版本日期', regulation('勞動基準法', { articleNumber: '24', includeHistory: true }, { article_no: '24', include_history: true }), { kind: 'field_equal', ours: 'article_history.versions[].date', theirs: 'article_history.revisions[].date' }),
  xf('H-勞基法24-text', 'JUR-821', '勞動基準法第 24 條歷次版本條文', regulation('勞動基準法', { articleNumber: '24', includeHistory: true }, { article_no: '24', include_history: true }), { kind: 'text_norm', ours: 'article_history.versions[].text', theirs: 'article_history.revisions[].content' }),
  xf('H-刑法56', 'JUR-821', '刑法第 56 條（已刪除）有歷史版本', regulation('刑法', { articleNumber: '56', includeHistory: true }, { article_no: '56', include_history: true }), { kind: 'field_presence', ours: 'article_history.versions', theirs: 'article_history.revisions' }),
  xf('H-民法沿革', 'JUR-821', '民法整部沿革', regulation('民法', { includeHistory: true }, { include_history: true }), { kind: 'text_norm', ours: 'history', theirs: 'history' }),

  xf('E-民法184', 'JUR-822', '民法第 184 條英譯', regulation('民法', { articleNumber: '184', language: 'en' }, { article_no: '184', language: 'en' }), { kind: 'text_norm', ours: 'articles[].content', theirs: 'articles[].content' }),
  xf('E-勞基法24', 'JUR-822', '勞動基準法第 24 條英譯', regulation('勞動基準法', { articleNumber: '24', language: 'en' }, { article_no: '24', language: 'en' }), { kind: 'text_norm', ours: 'articles[].content', theirs: 'articles[].content' }),

  ...interpretationFields('748', '釋字第748號', 'issues'),
  ...interpretationFields('111-1', '111年憲判字第1號', 'issue_summary'),
  xf('C-748-reasoning', 'JUR-738', '釋字第748號理由書', same('get_interpretation', { caseId: '釋字第748號', includeReasoning: true }, { case_id: '釋字第748號', include_reasoning: true }), { kind: 'text_norm', ours: 'reasoning', theirs: 'reasoning' }),
  xf('C-111-1-reasoning', 'JUR-738', '111年憲判字第1號理由', same('get_interpretation', { caseId: '111年憲判字第1號', includeReasoning: true }, { case_id: '111年憲判字第1號', include_reasoning: true }), { kind: 'text_norm', ours: 'reasoning', theirs: 'reasoning' }),
  xf('C-748-平等', 'JUR-738', '釋字第748號理由書「平等」片段數', same('get_interpretation', { caseId: '釋字第748號', reasoningKeyword: '平等' }, { case_id: '釋字第748號', reasoning_keyword: '平等' }), { kind: 'field_equal', ours: 'reasoning_matches#len', theirs: 'reasoning_matches#len' }),
  xf('C-search-隱私權', 'JUR-738', 'search_interpretations「隱私權」', same('search_interpretations', { keyword: '隱私權' }, { keyword: '隱私權' }), { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].case_id', min: 'all' }),
  xf('C-search-人性尊嚴-112', 'JUR-738', 'search_interpretations「人性尊嚴」112 年', same('search_interpretations', { keyword: '人性尊嚴', year: 112 }, { keyword: '人性尊嚴', year: 112 }), { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].case_id', min: 'all' }),
  xf('C-search-700-720', 'JUR-738', 'search_interpretations 第 700–720 號', same('search_interpretations', { numberFrom: 700, numberTo: 720 }, { number_from: 700, number_to: 720 }), { kind: 'id_set', ours: 'results[].case_id', theirs: 'results[].case_id', min: 'all' }),
  xf('C-748-cites', 'JUR-738', '釋字第748號 cites', same('get_citations', { caseId: '釋字第748號', direction: 'cites' }, { case_id: '釋字第748號', direction: 'cites' }), { kind: 'id_set', ours: 'citations[].case_id', theirs: 'citations[].case_id', min: 'all' }),
  xf('C-748-cited_by', 'JUR-738', '釋字第748號 cited_by', same('get_citations', { caseId: '釋字第748號', direction: 'cited_by' }, { case_id: '釋字第748號', direction: 'cited_by' }), { kind: 'id_set', ours: 'cited_by[].case_id', theirs: 'cited_by[].case_id', min: 'all' }),

  ...(['pending', 'hearing', 'amicus'] as const).map((status) =>
    xf(`D-${status}`, 'JUR-824', `受理案件清單 ${status}`, same('search_constitutional_docket', { status }, { status }), { kind: 'id_set', ours: 'results[].id', theirs: 'results[].id', min: 'all' })),
  xf('D-113-8-documents', 'JUR-824', '113年憲判字第8號文件清單', same('get_constitutional_case_file', { caseId: '113年憲判字第8號' }, { case_id: '113年憲判字第8號' }), { kind: 'id_set', ours: 'documents[].id', theirs: 'documents[].id', min: 'all' }),
  xf('D-113-8-人性尊嚴', 'JUR-824', '113年憲判字第8號「人性尊嚴」命中文件', same('get_constitutional_case_file', { caseId: '113年憲判字第8號', keyword: '人性尊嚴' }, { case_id: '113年憲判字第8號', keyword: '人性尊嚴' }), { kind: 'id_set', ours: 'documents[].id', theirs: 'documents[].id', min: 'all' }),

  xf('A-勞基法24-ids', 'JUR-739', '函釋「勞動基準法第24條」＋勞動部 id 集合', same('search_agency_interpretations', { keyword: '勞動基準法第24條', agency: '勞動部' }, { keyword: '勞動基準法第24條', agency: '勞動部' }), { kind: 'id_set', ours: 'results[].id', theirs: 'results[].id', min: 'all' }),
  xf('A-勞基法24-status', 'JUR-739', '函釋「勞動基準法第24條」＋勞動部 status 逐筆', same('search_agency_interpretations', { keyword: '勞動基準法第24條', agency: '勞動部' }, { keyword: '勞動基準法第24條', agency: '勞動部' }), { kind: 'field_equal', ours: 'results[].status', theirs: 'results[].status' }),
  xf('A-字號', 'JUR-739', '函釋字號「法律字第11403512580號」找到同一件', same('search_agency_interpretations', { docNumber: '法律字第11403512580號' }, { doc_number: '法律字第11403512580號' }), { kind: 'id_set', ours: 'results[].id', theirs: 'results[].id', min: 1 }),
  xf('A-營業稅-ids', 'JUR-739', '財政部、經濟部「營業稅」113–114 id 集合', same('search_agency_interpretations', { agency: '財政部,經濟部', keyword: '營業稅', yearFrom: 113, yearTo: 114 }, { agency: '財政部,經濟部', keyword: '營業稅', year_from: 113, year_to: 114 }), { kind: 'id_set', ours: 'results[].id', theirs: 'results[].id', min: 'all' }),
  xf('A-營業稅-sources', 'JUR-739', '財政部、經濟部「營業稅」categories 來源', same('search_agency_interpretations', { agency: '財政部,經濟部', keyword: '營業稅', yearFrom: 113, yearTo: 114 }, { agency: '財政部,經濟部', keyword: '營業稅', year_from: 113, year_to: 114 }), { kind: 'id_set', ours: 'categories[].source', theirs: 'categories[].source', min: 'all' }),
  xf('A-營業稅-total', 'JUR-739', '財政部、經濟部「營業稅」總筆數', same('search_agency_interpretations', { agency: '財政部,經濟部', keyword: '營業稅', yearFrom: 113, yearTo: 114 }, { agency: '財政部,經濟部', keyword: '營業稅', year_from: 113, year_to: 114 }), { kind: 'field_equal', ours: 'total_count', theirs: 'total_count' }),
  xf('A-個人資料', 'JUR-739', '不指定機關「個人資料」去重後 id 集合', same('search_agency_interpretations', { keyword: '個人資料' }, { keyword: '個人資料' }), { kind: 'id_set', ours: 'results[].id', theirs: 'results[].id', min: 'all' }),
]
