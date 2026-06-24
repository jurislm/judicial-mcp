# Tasks: Migrate to TypeScript + Vitest + ESM

> All tasks were completed in `c6321d2` (PR #9). Checkboxes are marked retroactively for
> the archive record. Each implementation task is paired with a test/verification task.

## 1. Tooling config

- [x] 1.1 Add `tsconfig.json` (`module: ESNext`, `moduleResolution: bundler`,
  `target: ES2022`, `strict: true`, `declaration: true`, `declarationDir: types`)
- [x] 1.2 Flip `package.json` to `"type": "module"`; point `main` / `bin` / `start` / `dev`
  at the `.ts` entry points
- [x] 1.3 Replace the Jest config with `vitest.config.ts` (`environment: 'node'`)
- [x] 1.4 Adjust `eslint.config` for ESM compatibility; keep `--max-warnings=0`
- [x] 1.5 Add `typecheck` + `build:types` scripts; update `prepublishOnly`

## 2. Source migration

- [x] 2.1 `src/response.js` → `src/response.ts` with typed `McpToolResult` / `ContentBlock`
- [x] 2.2 `src/tools.js` → `src/tools.ts`; add `TokenArgs` / `GetJudgmentArgs` /
  `ListResourcesArgs` / `DownloadFileArgs`; add `apiErrorMessage(error: unknown)`
- [x] 2.3 Split `src/index.js` into `src/index.ts` (stdout guard + dynamic
  `import('./server.js')`) and `src/server.ts` (Server wiring, request handlers, transport)
- [x] 2.4 `bin/judicial-mcp.js` → `bin/judicial-mcp.ts` (`#!/usr/bin/env bun`)
- [x] 2.5 Delete the hand-written `types/index.d.ts`; generate via `tsc --emitDeclarationOnly`

## 3. Tests (Vitest)

- [x] 3.1 `__tests__/response.test.js` → `.ts`; `jest.mock` → `vi.mock`,
  `vi.mocked(axios.*)`
- [x] 3.2 `__tests__/tools.test.js` → `.ts`; cover success + each error path for all 7 handlers
- [x] 3.3 `__tests__/mcp.test.js` → `.ts`; cover routing + unknown-tool + blob response path
- [x] 3.4 Verify `bun run test` green (53 tests passing)

## 4. Verification

- [x] 4.1 `bun run typecheck` clean (no implicit `any`, strict mode)
- [x] 4.2 `bun run lint` clean (`--max-warnings=0`)
- [x] 4.3 Update `openspec/config.yaml` + `CLAUDE.md` to reflect the TS / ESM / Vitest stack
