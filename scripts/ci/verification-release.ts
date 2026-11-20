import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const stable = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const verification = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-v6verify\.([1-9]\d*)(?:\.([1-9]\d*))?$/;
const paths = ["package.json", "plugin.json", ".codex-plugin/plugin.json", ".release-please-manifest.json"];

function exact(pattern: RegExp, value: string): boolean {
  return pattern.exec(value)?.[0] === value;
}

export function releasePlan(version: string, event: string | undefined, tag: string | undefined): { verification: boolean; distTag: string | null } {
  if (exact(verification, version)) {
    if (event !== "tag" || tag !== `v${version}`) throw new Error("verification requires its exact tag event");
    return { verification: true, distTag: "v6-verification" };
  }
  if (!exact(stable, version)) throw new Error("unsupported release version");
  if (event !== "tag" && event !== "manual") throw new Error("unsupported release event");
  if (event === "tag" && tag !== `v${version}`) throw new Error("release tag mismatch");
  return { verification: false, distTag: null };
}

export function preparedVersions(versions: string[], event: string | undefined, tag: string | undefined): string | null {
  const base = versions[0];
  if (!base || !exact(stable, base) || versions.some(value => value !== base)) throw new Error("source manifests must share a stable version");
  if (tag?.startsWith(`v${base}-v6verify.`)) {
    const version = tag.slice(1);
    releasePlan(version, event, tag);
    return version;
  }
  releasePlan(base, event, tag);
  return null;
}

function source(path: string): Record<string, unknown> {
  return JSON.parse(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" })) as Record<string, unknown>;
}

function versionOf(doc: Record<string, unknown>, index: number): string {
  const value = doc[index === 3 ? "." : "version"];
  if (typeof value !== "string") throw new Error("missing manifest version");
  return value;
}

function checkPublishConfig(pkg: Record<string, unknown>, distTag: string | null): void {
  if (!distTag || pkg.publishConfig === undefined) return;
  const config = pkg.publishConfig as Record<string, unknown>;
  if (!config || typeof config !== "object" || (config.tag !== undefined && config.tag !== distTag)) throw new Error("conflicting publish configuration");
  for (const [key, value] of Object.entries(config)) {
    if ((key === "registry" || key.endsWith(":registry")) && value !== "https://registry.npmjs.org/") throw new Error("unexpected publication registry");
  }
}

export function execute(mode: string): void {
  if (mode !== "prepare" && mode !== "publish") throw new Error("expected prepare or publish");
  const event = process.env.CI_PIPELINE_EVENT;
  const tag = process.env.CI_COMMIT_TAG;
  const originals = paths.map(source);
  const name = originals[0]!.name;
  if (!["@jurislm/woodpecker-ci-plugin", "@jurislm/coolify-plugin", "@jurislm/judicial-mcp"].includes(String(name))) throw new Error("unexpected package");
  if (event === "manual" && name !== "@jurislm/judicial-mcp") throw new Error("manual publishing not supported");
  const target = preparedVersions(originals.map(versionOf), event, tag);
  const current = paths.map(path => JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
  if (current[0]!.name !== name) throw new Error("package name changed");
  const expected = target ?? versionOf(originals[0]!, 0);
  if (mode === "prepare") {
    if (current.some((doc, index) => versionOf(doc, index) !== versionOf(originals[index]!, index))) throw new Error("checkout versions changed before prepare");
    if (target) {
      const output = current.map((doc, index) => JSON.stringify({ ...doc, [index === 3 ? "." : "version"]: target }, null, 2) + "\n");
      output.forEach((text, index) => writeFileSync(paths[index]!, text));
    }
    return;
  }
  if (current.some((doc, index) => versionOf(doc, index) !== expected)) throw new Error("prepared manifests mismatch");
  const plan = releasePlan(expected, event, tag);
  checkPublishConfig(current[0]!, plan.distTag);
  if (name === "@jurislm/judicial-mcp") {
    execFileSync("bun", ["scripts/ci/check-release-tag.ts"], { stdio: "inherit" });
    const archives = readdirSync(".release").filter(path => path.endsWith(".tgz"));
    if (archives.length !== 1) throw new Error("expected exactly one release archive");
    const archive = `.release/${archives[0]}`;
    const pkg = JSON.parse(execFileSync("tar", ["-xOf", archive, "package/package.json"], { encoding: "utf8" })) as Record<string, unknown>;
    checkPublishConfig(pkg, plan.distTag);
    if (pkg.name !== name || pkg.version !== expected) throw new Error("archive package mismatch");
    execFileSync("npm", ["publish", archive, "--access", "public", "--ignore-scripts", ...(plan.distTag ? ["--tag", plan.distTag] : [])], { stdio: "inherit" });
  } else {
    execFileSync(name === "@jurislm/woodpecker-ci-plugin" ? "bun" : "npm", ["publish", "--access", "public", ...(plan.distTag ? ["--tag", plan.distTag] : [])], { stdio: "inherit" });
  }
}

if (import.meta.main) execute(process.argv[2] ?? "");
