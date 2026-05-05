## Context

The codebase is 3 source files (~460 lines total) in CommonJS JavaScript. It already has Bun as its sole runtime and a hand-written `types/index.d.ts` for external consumers. The migration touches every file in `src/`, `bin/`, and `__tests__/`, plus tooling config — but no tool behavior changes.

## Goals / Non-Goals

**Goals:**
- Compile-time type safety on all 7 handler `args` parameters (no implicit `any`)
- `strict: true` TypeScript — including `strictNullChecks`, `noImplicitAny`, `useUnknownInCatchVariables`
- Replace Jest with Vitest (ESM-native, faster, near-identical API)
- Replace CommonJS with ESM (`"type": "module"`)
- Auto-generate `types/index.d.ts` from source via `tsc --declaration`
- Zero build step — Bun executes `.ts` natively

**Non-Goals:**
- No new tools or behavior changes
- No Zod or runtime validation library — `validateInput` helpers remain
- No `dist/` compilation target or CI build pipeline
- No npx support (Bun-only)

## Decisions

### D1: ESM over CommonJS
**Choice:** Flip `"type": "module"` in `package.json`, convert all `require()` to `import`.  
**Why:** Vitest is ESM-first; `vi.mock()` hoisting requires static `import`. The MCP SDK already targets ESM — current `require()` calls run through a CJS compatibility shim. ESM is the correct target.  
**Alternative considered:** Keep CJS + configure Vitest for CJS. Rejected: adds friction to every Vitest config touchpoint, and CJS is a dead end for this stack.

### D2: Bun-native execution, no build step
**Choice:** Source files are `.ts`, Bun runs them directly. `bin/judicial-mcp.ts` replaces `.js`.  
**Why:** Bun strips types at runtime natively. Adding `tsc` as a build step would complicate the publish workflow with no benefit — the package is consumed via `bunx`, not `node`.  
**Alternative considered:** Compile to `dist/` and publish compiled JS. Rejected: unnecessary for a Bun-only distribution.

### D3: `tsc --declaration` replaces hand-written types
**Choice:** Add `"declaration": true` + `"declarationDir": "types"` to `tsconfig.json`. Delete `types/index.d.ts`.  
**Why:** The hand-written file can drift from source. Auto-generated declarations are always accurate.  
**tsconfig target:** `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"target": "ES2022"`, `"strict": true`, `"declaration": true`.  
**Note:** Originally planned `NodeNext`/`NodeNext`, switched to `ESNext`/`bundler` (Bun-native) after finding MCP SDK import paths required explicit `.js` extensions under NodeNext — see Risks section.

### D4: Handler args typed via interfaces in `src/tools.ts`
**Choice:** Define one interface per handler at the top of `src/tools.ts`.  

```ts
interface ListJudgmentsArgs { token: string }
interface GetJudgmentArgs  { token: string; jid: string }
interface ListResourcesArgs { categoryNo: string; token: string }
interface DownloadFileArgs  { fileSetId: string; token: string; top?: number; skip?: number }
```

`auth_token` and `member_token` take no args — typed as `Record<string, never>`.  
**Why:** Inline types per handler are unreadable at scale. Named interfaces are reusable in tests.

### D5: `catch` blocks use `unknown` narrowing helper
**Choice:** Add a module-level helper in `src/tools.ts`:

```ts
function apiErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const e = error as { response?: { data?: { message?: string } }; message?: string }
    return e.response?.data?.message ?? e.message ?? String(error)
  }
  return String(error)
}
```

All `catch` blocks call `apiErrorMessage(error)`.  
**Why:** Avoids repeating the narrowing pattern 7 times.

### D6: Vitest config — minimal `vitest.config.ts`
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```
`jest.mock` → `vi.mock`, `mockedAxios.post` → `vi.mocked(axios.post)`. Test structure (describe/test/beforeEach/afterEach) unchanged.

### D7: New `bun run typecheck` script
Add `"typecheck": "tsc --noEmit"` to `package.json` scripts. `prepublishOnly` updated to run typecheck + test + lint.

## Risks / Trade-offs

- **`axios` mock pattern changes** — `vi.mock` with ESM requires static import. All 3 test files need updating, but the pattern is mechanical.  
  → Mitigation: migrate test files last, verify with `bun run test` after each file.

- **`@modelcontextprotocol/sdk` import paths** — The SDK uses `.js` extension imports internally. With `"moduleResolution": "NodeNext"`, imports may need explicit `.js` extensions even for `.ts` source files.  
  → Mitigation: check SDK exports map before writing imports; use `"moduleResolution": "Bundler"` as fallback if NodeNext causes issues.

- **`types/index.d.ts` auto-generation path** — `tsc --declaration` writes `.d.ts` next to source by default. The `declarationDir` must be configured to match `"types": "types/index.d.ts"` in `package.json`.  
  → Mitigation: verify generated file path matches `package.json` `"types"` field after first typecheck run.
