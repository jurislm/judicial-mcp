import { expect, test } from "vitest";
import { releasePlan, preparedVersions } from "../scripts/ci/verification-release.js";

test("verification tag selects only the fixed non-latest channel", () => {
  expect(releasePlan("2.1.2-v6verify.20261117.1", "tag", "v2.1.2-v6verify.20261117.1")).toEqual({ verification: true, distTag: "v6-verification" });
});

test.each([undefined, "v2.1.3", "v2.1.2-beta.1", "v2.1.2-v6verify.0", "v2.1.2-v6verify.01", "v2.1.2-v6verify.1\n"])("invalid verification tag fails closed: %s", (tag) => {
  expect(() => releasePlan("2.1.2-v6verify.1", "tag", tag)).toThrow();
});

test("manual verification is forbidden and stable tag is unchanged", () => {
  expect(() => releasePlan("2.1.2-v6verify.1", "manual", "v2.1.2-v6verify.1")).toThrow();
  expect(releasePlan("2.1.2", "tag", "v2.1.2")).toEqual({ verification: false, distTag: null });
});

test("prepare binds all manifests to the stable source version", () => {
  expect(preparedVersions(["2.1.2", "2.1.2", "2.1.2", "2.1.2"], "tag", "v2.1.2-v6verify.1")).toBe("2.1.2-v6verify.1");
  expect(() => preparedVersions(["2.1.2", "2.1.1"], "tag", "v2.1.2-v6verify.1")).toThrow();
  expect(() => preparedVersions(["2.1.2"], "tag", "v2.1.3-v6verify.1")).toThrow();
  expect(preparedVersions(["2.1.2"], "tag", "v2.1.2")).toBeNull();
});

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const bun = execFileSync("which", ["bun"], { encoding: "utf8" }).trim();
const script = resolve("scripts/ci/verification-release.ts");
test.each(["@jurislm/woodpecker-ci-plugin", "@jurislm/coolify-plugin", "@jurislm/judicial-mcp"])("actual publisher argv stays isolated for %s", (name) => {
  const dir = mkdtempSync(join(tmpdir(), "verification-release-"));
  try {
    mkdirSync(join(dir, ".codex-plugin"));
    mkdirSync(join(dir, "fake"));
    const pkg = { name, version: "2.1.2" };
    for (const file of ["package.json", "plugin.json", ".codex-plugin/plugin.json"]) writeFileSync(join(dir, file), JSON.stringify(pkg));
    writeFileSync(join(dir, ".release-please-manifest.json"), JSON.stringify({ ".": "2.1.2" }));
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "."], { cwd: dir });
    execFileSync("git", ["-c", "user.name=fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"], { cwd: dir });
    const record = join(dir, "record");
    for (const cli of ["bun", "npm"]) writeFileSync(join(dir, "fake", cli), '#!/bin/sh\nif test "$1" = publish; then printf "%s\\n" "$@" >> "$RECORD"; fi\n', { mode: 0o700 });
    const env = { PATH: `${dir}/fake:/usr/bin:/bin`, RECORD: record, CI_PIPELINE_EVENT: "tag", CI_COMMIT_TAG: "v2.1.2-v6verify.1", NPM_CONFIG_TAG: "latest" };
    const run = (mode: string) => spawnSync(bun, [script, mode], { cwd: dir, env });
    expect(run("publish").status).not.toBe(0);
    expect(run("prepare").status).toBe(0);
    if (name === "@jurislm/judicial-mcp") {
      mkdirSync(join(dir, ".release"));
      mkdirSync(join(dir, "package"));
      writeFileSync(join(dir, "package/package.json"), readFileSync(join(dir, "package.json")));
      execFileSync("tar", ["-czf", ".release/pkg.tgz", "package/package.json"], { cwd: dir });
    }
    if (name === "@jurislm/judicial-mcp") {
      writeFileSync(join(dir, "package/package.json"), JSON.stringify(pkg));
      execFileSync("tar", ["-czf", ".release/pkg.tgz", "package/package.json"], { cwd: dir });
      expect(run("publish").status).not.toBe(0);
      writeFileSync(join(dir, "package/package.json"), readFileSync(join(dir, "package.json")));
      execFileSync("tar", ["-czf", ".release/pkg.tgz", "package/package.json"], { cwd: dir });
    }
    const prepared = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ ...prepared, publishConfig: { tag: "latest" } }));
    expect(run("publish").status).not.toBe(0);
    writeFileSync(join(dir, "package.json"), JSON.stringify(prepared));
    expect(run("publish").status).toBe(0);
    const args = readFileSync(record, "utf8").trim().split("\n");
    expect(args.slice(-2)).toEqual(["--tag", "v6-verification"]);
    expect(args).not.toContain("latest");
    writeFileSync(join(dir, "plugin.json"), JSON.stringify({ ...pkg, version: "2.1.2" }));
    expect(run("publish").status).not.toBe(0);
    execFileSync("git", ["restore", "package.json", "plugin.json", ".codex-plugin/plugin.json", ".release-please-manifest.json"], { cwd: dir });
    env.CI_COMMIT_TAG = "v2.1.2";
    const before = readFileSync(join(dir, "package.json"), "utf8");
    expect(run("prepare").status).toBe(0);
    expect(readFileSync(join(dir, "package.json"), "utf8")).toBe(before);
    writeFileSync(record, "");
    if (name === "@jurislm/judicial-mcp") {
      writeFileSync(join(dir, "package/package.json"), before);
      execFileSync("tar", ["-czf", ".release/pkg.tgz", "package/package.json"], { cwd: dir });
    }
    expect(run("publish").status).toBe(0);
    expect(readFileSync(record, "utf8").trim().split("\n")).toEqual(name === "@jurislm/judicial-mcp" ? ["publish", ".release/pkg.tgz", "--access", "public", "--ignore-scripts"] : ["publish", "--access", "public"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
