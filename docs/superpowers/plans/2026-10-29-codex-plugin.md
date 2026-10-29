# Codex Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans task-by-task.

**Goal:** Publish repo-installable Codex plugin without restoring manual MCP configuration.
**Architecture:** Portable manifests and compatibility overlay wrap the npm CLI. The CLI ships a dependency-free Bun bundle built from the lockfile. Release automation keeps manifest versions synchronized.
**Tech Stack:** TypeScript, Bun, Vitest, JSON manifests, release-please, Woodpecker.
**Spec:** docs/superpowers/specs/2026-10-29-codex-plugin-design.md

## Global Constraints

No code comments. No secrets in manifests or logs. All existing tools preserved. No lifecycle hooks. No global manual MCP entry. Public directory submission is not installation from repo marketplace.

## Review Focus

- Packed CLI must work without adjacent source or dependency tree; exercise extracted package.
- stdio output must contain only JSON-RPC; verify initialize/tools-list.
- Portable and compatibility MCP wiring must agree; verify manifests and schema.
- Release validation must reject any unrelated manifest changes; regression tests.
- Installation/discovery must use clean Codex state; verify no global config changes.

### Task1: Bundled npm runtime

Own package.json, scripts/build-runtime.ts, __tests__/runtime-package.test.ts, .woodpecker/npm-release.yml.
- [ ] Add failing packed-runtime startup test.
- [ ] Observe expected RED.
- [ ] Build dependency-free Bun bundle before pack and include dist CLI in npm files/bin.
- [ ] Verify extracted tarball initialize/tools-list with no node_modules; full tests/lint/typecheck.

### Task2: Plugin manifests and release/distribution

Own plugin.json, mcp.json, .codex-plugin/plugin.json, .mcp.json, .agents/plugins/marketplace.json, README.md, release-please-config.json, scripts/ci/release-pr-auto-merge.ts and associated tests.
- [ ] Add failing contract/release tests.
- [ ] Implement canonical manifests, compatibility wiring and repo marketplace.
- [ ] Sync two manifest versions and narrowly validate release-only changes.
- [ ] Validate schema and isolated Codex discovery/install.
- [ ] Run complete validation, independent reviews, current-head CI, merge/release and published runtime readback.
