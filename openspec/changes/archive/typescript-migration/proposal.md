# Proposal: Migrate to TypeScript + Vitest + ESM

## Status

Implemented and merged in `c6321d2` (PR #9). This proposal is backfilled and archived
retroactively to complete the OpenSpec record for an already-shipped change.

## Why

The codebase was 3 CommonJS JavaScript source files with a hand-written
`types/index.d.ts` that could drift from source. Handler `args` were untyped (implicit
`any`) and `catch` blocks handled untyped errors. Bun already runs `.ts` natively with no
build step, so TypeScript adds compile-time safety at zero distribution cost.

## What Changes

- Convert all `src/`, `bin/`, and `__tests__/` files from `.js` (CommonJS) to `.ts`
  (ESM, `strict: true`).
- Replace Jest with Vitest (ESM-native, `vi.mock` static-import hoisting).
- Add an explicit `Args` interface for every handler — no implicit `any`.
- Add `apiErrorMessage(error: unknown)` for safe `catch` narrowing (shared across handlers).
- Auto-generate `types/index.d.ts` via `tsc --emitDeclarationOnly` (gitignored); delete the
  hand-written file.
- Add a `bun run typecheck` script; `prepublishOnly` runs typecheck + test + lint + build:types.
- Split `index.ts` (stdout-guard bootstrap) from `server.ts` (server wiring) so the
  `console.*` → stderr override runs before any ESM module initializes.

## Affected Tools

None behaviorally. All 7 tools — `auth_token`, `member_token`, `list_judgments`,
`get_judgment`, `list_categories`, `list_resources`, `download_file` — keep identical
inputs, outputs, and upstream endpoints. This is a pure tooling / type-safety migration.

## Non-goals

- No new tools or behavior changes.
- No Zod or runtime validation library — the `validateInput` helpers remain.
- No `dist/` build target or compiled-JS publish (Bun-only, `.ts` shipped directly).
- No npx support (Bun-only).

## Environment Variables

Unchanged: `JUDICIAL_USER`, `JUDICIAL_PASSWORD`.
