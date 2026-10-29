import { describe, expect, it } from 'vitest'
import { resolveArticleEffectiveness } from '../src/article-effectiveness.js'

const sourceUrl = 'https://law.moj.gov.tw/LawClass/LawHistory.aspx?pcode=B0000001'
const checkedAt = '2026-10-29T04:00:00.000Z'
const revision = '民國 115 年 08 月 17 日'
const original = '中華民國十八年五月二十三日國民政府制定公布全文152條；並自中華民國十八年十月十日施行'
const debt = '中華民國八十八年四月二十一日總統令修正公布第159、160、184、186、312～315條條文；並增訂第166-1、191-1～191-3條條文；並刪除第219條條文；並自八十九年五月五日施行；但第166-1條施行日期，由行政院會同司法院另定之'
const newest = '中華民國一百十五年八月十七日總統令修正公布第1223條條文；並自公布六個月後施行'
const warning = '1.八十八年四月二十一日增訂之第166-1條條文施行日期，由行政院會同司法院另定之。<br>2.一百十五年八月十七日修正公布第1223條條文，自公布六個月後施行。'

function metadata(name = '民法', date = revision, memo = '') {
  return `<table><tr><th>法規名稱：</th><td><a id="hlLawName">${name}</a></td></tr><tr id="trLNNDate"><th>修正日期：</th><td>${date}</td></tr>${memo ? `<tr id="VaildState"><td>本法規部分或全部條文尚未生效，最後生效日期：未定<div class="law-vaildMemo">${memo}</div></td></tr>` : ''}</table>`
}

function history(rows: string[], name = '民法', date = revision) {
  return metadata(name, date) + `<div class="law-history">${rows.map(row => `<div class="row"><div class="col-data">${row}</div></div>`).join('')}</div>`
}

function resolve(articleNumber: string, rows = [newest, debt, original], options: { memo?: string; time?: string; historyName?: string; historyDate?: string; articleText?: string; statusWarning?: string } = {}) {
  return resolveArticleEffectiveness({
    historyHtml: history(rows, options.historyName, options.historyDate),
    articleHtml: metadata('民法', revision, options.memo ?? '') + (options.statusWarning ? `<table><tr id="VaildState"><td>${options.statusWarning}</td></tr></table>` : '') + `<div class="law-reg-content"><div class="row"><div class="col-no">第 ${articleNumber} 條</div><div class="col-data">${options.articleText ?? '條文內容'}</div></div></div>`,
    articleText: options.articleText ?? '條文內容',
    lawName: '民法', articleNumber, checkedAt: options.time ?? checkedAt, sourceUrl,
  })
}

describe('resolveArticleEffectiveness', () => {
  it('resolves the newest whole-article revision despite an older original full-text record', () => {
    const result = resolve('184', undefined, { memo: warning })
    expect(result).toMatchObject({ status: 'effective', effective_date: '2000-05-05', checked_at: checkedAt })
    expect(result.basis).toEqual(expect.arrayContaining([expect.objectContaining({ source_url: sourceUrl, text: expect.stringContaining('八十九年五月五日') })]))
  })

  it('distinguishes a decree document number from residual article scope', () => {
    const row = '中華民國一百十五年八月十七日總統華總一義字第11500076161號令修正公布第184條條文；並自一百十五年九月一日施行'
    expect(resolve('184', [row]).status).toBe('effective')
  })

  it('uses the complete current warning for the exact pending article', () => {
    expect(resolve('166-1', undefined, { memo: warning })).toMatchObject({ status: 'not_yet_effective', effective_date: null })
  })

  it('reports the current delayed warning without inventing a relative effective date', () => {
    expect(resolve('1223', undefined, { memo: warning })).toMatchObject({ status: 'not_yet_effective', effective_date: null })
  })

  it('changes status exactly at Taiwan midnight of the effective date', () => {
    const rows = ['中華民國一百十五年八月十七日總統令修正公布第1223條條文；並自一百十六年二月十七日施行']
    expect(resolve('1223', rows, { time: '2027-02-16T15:59:59.999Z' }).status).toBe('not_yet_effective')
    expect(resolve('1223', rows, { time: '2027-02-16T16:00:00.000Z' }).status).toBe('effective')
  })

  it('does not mistake promulgation day for its legally computed effective date', () => {
    const row = '中華民國一百十年一月二十日總統令修正公布第205條條文；施行日期另定之 中華民國一百十年一月二十日總統令修正公布第1030-1條條文；並自公布日施行'
    expect(resolve('1030-1', [newest, row]).status).toBe('unknown')
    expect(resolve('205', [newest, row]).status).toBe('unknown')
  })

  it('matches exact numeric article lists and subarticle ranges', () => {
    const row = '中華民國一百十年一月二十日總統令修正公布第191-1～191-3、205條條文；並自一百十年一月二十日施行'
    expect(resolve('191-2', [newest, row]).status).toBe('effective')
    expect(resolve('191', [newest, row]).status).toBe('unknown')
    expect(resolve('20', [newest, row]).status).toBe('unknown')
  })

  it.each([
    ['missing', []],
    ['no implementation date', ['中華民國一百十五年八月十七日總統令修正公布第184條條文']],
    ['paragraph date', ['中華民國一百十五年八月十七日總統令修正公布第184條第一項條文；並自公布日施行']],
    ['conditional date', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；施行日期由行政院定之']],
    ['mixed dates', ['中華民國一百十五年八月十七日總統令修正公布第184、186條條文；第184條第一項自公布日施行，其餘自一百十六年一月一日施行']],
    ['conflicting same-day records', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自一百十五年九月一日施行', '中華民國一百十五年八月十七日總統令修正公布第184條條文；並自一百十五年十月一日施行']],
    ['another article date', ['中華民國一百十五年八月十七日總統令修正公布第184、186條條文；第186條自一百十六年一月一日施行']],
    ['unparsed application qualification', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自一百十五年八月二十日施行；適用於行政院指定案件']],
    ['scoped exception', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自公布日施行，但涉及登記事項者另定之']],
    ['newer full text', ['中華民國一百十五年八月十七日總統令修正公布全文1300條', debt]],
    ['deleted', ['中華民國一百十五年八月十七日總統令刪除第184條條文；並自公布日施行']],
    ['impossible date', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自一百十五年二月三十日施行']],
    ['ambiguous relative period', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自主管機關公告後六個月施行']],
  ])('returns unknown for %s', (_label, rows) => {
    expect(resolve('184', rows).status).toBe('unknown')
  })

  it.each([
    '總統令修訂第184條條文；施行日期另定之',
    '總統令公布第184條修正之條文；施行日期另定之',
    '行政院令修正發布第184條條文；施行日期另定之',
    '總統令修正公布第183條及第184條條文；施行日期另定之',
    '總統令修正公布第184至第186條條文；施行日期另定之',
    '總統令修正公布第183～185～190條條文；並自一百十五年九月一日施行',
    '總統令修正公布名稱及第184條條文；並自一百十六年一月一日施行',
    '行政院令修正發布全文1300條；並自一百十五年九月一日施行',
  ])('blocks older evidence when a newer revision scope is unsupported: %s', clause => {
    expect(resolve('184', [`中華民國一百十五年八月十七日${clause}`, debt]).status).toBe('unknown')
  })

  it('rejects an unparsed Chinese article scope governing an effective date', () => {
    expect(resolve('184', ['中華民國一百十五年八月十七日總統令修正公布第184、186條條文；第一百八十六條自一百十五年九月一日施行']).status).toBe('unknown')
  })

  it.each(['一百十五年二三月一日', '一一六年九月一日'])('rejects malformed Chinese date numerals: %s', date => {
    expect(resolve('184', [`中華民國一百十五年八月十七日總統令修正公布第184條條文；並自${date}施行`]).status).toBe('unknown')
  })

  it.each([
    '本法規全部條文尚未生效',
    '本法規部分或全部條文尚未生效，最後生效日期：未定',
    '本法規部分條文尚未生效<div class="law-vaildMemo">施行日期另定之</div>',
    '本法規部分條文尚未生效<div class="law-vaildMemo">一百十五年八月十七日修正第一百八十六條施行日期另定之</div>',
  ])('does not ignore a current warning whose exclusion scope cannot be proven: %s', statusWarning => {
    expect(resolve('184', undefined, { statusWarning }).status).toBe('unknown')
  })

  it('returns unknown when a current pending note conflicts with an explicit whole-article date', () => {
    const rows = ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自一百十五年九月一日施行']
    const memo = '一百十五年八月十七日修正公布第184條施行日期，由行政院會同司法院另定之'
    expect(resolve('184', rows, { memo }).status).toBe('unknown')
  })

  it('does not treat unchanged text or absent warnings as proof', () => {
    expect(resolve('184', [newest, original]).status).toBe('unknown')
  })

  it('refuses mismatched law names or amendment dates', () => {
    expect(resolve('184', undefined, { historyName: '刑法' }).status).toBe('unknown')
    expect(resolve('184', undefined, { historyDate: '民國114年01月01日' }).status).toBe('unknown')
  })

  it('does not label deleted article text effective', () => {
    expect(resolve('184', undefined, { articleText: '（刪除）' }).status).toBe('unknown')
  })

  it('does not infer an undetermined pending status without a current warning', () => {
    expect(resolve('166-1').status).toBe('unknown')
  })

  it('leaves relative month-end calculation unknown without an explicit date', () => {
    expect(resolve('184', ['中華民國一百十五年一月三十一日總統令修正公布第184條條文；並自公布後一個月施行']).status).toBe('unknown')
  })

  it('rejects contradictory dates and invalid check timestamps', () => {
    expect(resolve('184', ['中華民國一百十五年八月十七日總統令修正公布第184條條文；並自一百十五年九月一日施行；並自一百十五年十月一日施行']).status).toBe('unknown')
    expect(resolve('184', undefined, { time: 'invalid' }).status).toBe('unknown')
  })
})

it('does not let an official commencement-only decree for another article block proven evidence', () => {
  const decree = '中華民國九十七年十月二十二日總統華總一義字第09700216301號令公布第22條修正條文定自九十八年一月一日施行'
  expect(resolve('184', [newest, decree, debt], { memo: warning })).toMatchObject({ status: 'effective', effective_date: '2000-05-05' })
})

it('uses the scope of a commencement-only decree when it targets the requested article', () => {
  const decree = '中華民國九十七年十月二十二日總統華總一義字第09700216301號令公布第184條修正條文定自九十八年一月一日施行'
  expect(resolve('184', [decree, debt])).toMatchObject({ status: 'effective', effective_date: '2009-01-01' })
})
