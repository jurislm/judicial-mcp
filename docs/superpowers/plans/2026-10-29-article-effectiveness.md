# Article effectiveness implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Return conservative article-level effective status with official evidence.
**Architecture:** Pure resolver owns official history/date interpretation. Existing regulation-source owns bounded retrieval, source validation, caching and response integration.
**Tech Stack:** TypeScript, Cheerio, Vitest, Bun.
**Spec:** docs/superpowers/specs/2026-10-29-article-effectiveness-design.md

## Global Constraints

No code comments. No new dependencies. Unknown when proof is insufficient. Use official law.moj.gov.tw only. Preserve law-level version metadata.

## Review Focus

Newer full-text revisions must prevent using older article evidence. Partial-article conditions must not be treated as whole-article dates. Chinese dates and calendar boundaries must fail closed. History law/version mismatch must fail closed. Cached decisions must expire across a Taiwan date boundary.

### Task 1: Pure resolver

Files: src/article-effectiveness.ts, __tests__/article-effectiveness.test.ts.
Interface: resolveArticleEffectiveness({historyHtml,articleHtml,lawName,articleNumber,checkedAt,sourceUrl}): ArticleEffectiveness.
- [x] Write failing tests for 184 effective, 166-1 pending undetermined, 1223 delayed, missing/ambiguous/partial evidence and date boundaries.
- [x] Run focused tests and confirm intended failures.
- [x] Implement conservative parser and evidence-producing resolver.
- [x] Run focused tests to pass.

### Task 2: Integration and release

Files: src/regulation-source.ts, src/tools.ts, __tests__/regulation.test.ts, README.md.
- [x] Add failing integration tests for history retrieval, unknown on failure/mismatch, cached response and cross-day invalidation.
- [x] Fetch bounded official LawHistory HTML, add article_text_version=latest_promulgated and article_effectiveness; preserve existing fields.
- [ ] Run full test, typecheck, lint and public-source readback.
- [ ] Review whole diff, resolve findings, open PR, verify current-head CI, merge and publish through existing release pipeline.
- [ ] Verify published package and fixed local MCP installation. Report actual runtime layer separately from active chat reload.
