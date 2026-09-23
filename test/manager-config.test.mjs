// Manager-specific configuration files as evidence.
//
// Origin: on 2026-09-22 the engine emitted a `proven` npm-vs-pnpm conflict for
// AIEraDev/Clypra. Everything the engine could see said npm — `npm ci` in all
// three workflows, `npm install` in README and CONTRIBUTING, no packageManager
// field. What it could not see was `pnpm-workspace.yaml`, carrying pnpm's own
// `allowBuilds` and `minimumReleaseAgeExclude` settings with three weeks of
// commit history. pnpm was deliberate; the finding was wrong.
//
// The fix is deliberately conservative. Configuration never creates or resolves
// a conflict, and it only ever downgrades a finding out of the proven tier —
// never suppresses one. It applies in exactly one shape: no packageManager
// field, one manager carrying real settings, another independently operated.
import test from "node:test";
import assert from "node:assert/strict";
import { scanFiles } from "../src/crosscheck.mjs";
import { managerConfigValue } from "../src/evidence.mjs";

const scan = (files) => scanFiles(new Map(Object.entries(files).map(([k, v]) => [k, v === true ? null : typeof v === "string" ? v : JSON.stringify(v)])));
const wf = (...runs) => `on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n${runs.map((r) => `      - run: ${r}\n`).join("")}`;
const conflict = (files, scope = "") => scan(files).findings.find((f) => f.rule === "package-manager/conflicting-config" && f.scope === scope);

// ---------- the regression that prompted this ----------

test("Clypra: maintained pnpm settings beside npm CI is ambiguity, not a contradiction", () => {
  const f = conflict({
    "package.json": { name: "clypra" },
    "package-lock.json": true,
    "pnpm-lock.yaml": true,
    "pnpm-workspace.yaml": "allowBuilds:\n  canvas: false\n  esbuild: false\nminimumReleaseAgeExclude:\n  - '@clypra-studio/engine@1.8.0'\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "experimental", "must leave the proven tier");
  assert.match(f.summary, /ambiguity/);
  assert.match(f.summary, /npm and pnpm are each deliberately configured/);
  assert.ok(f.evidence.some((e) => e.kind === "manager-config" && e.source === "pnpm-workspace.yaml"));
  assert.match(f.fix, /cannot tell from the repository whether that is deliberate dual support or an unfinished migration/);
});

test("the finding is downgraded, never removed", () => {
  const all = scan({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: false\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  }).findings.filter((f) => f.rule === "package-manager/conflicting-config");
  assert.equal(all.length, 1, "still reported, just not in the default tier");
});

// ---------- configuration that is present but not authoritative ----------

test("a pnpm-workspace.yaml holding only `packages:` is structure, not intent", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\n  - 'libs/*'\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "proven", "a workspace list survives a migration exactly like a stale lockfile");
  assert.ok(!f.evidence.some((e) => e.kind === "manager-config"));
});

test("an empty or comment-only config file is not evidence", () => {
  assert.equal(managerConfigValue("pnpm-workspace.yaml", ""), null);
  assert.equal(managerConfigValue(".yarnrc", "# nothing here\n"), null);
  assert.equal(managerConfigValue("bunfig.toml", ""), null);
});

test("a plain .npmrc is shared by npm, pnpm and yarn classic, so it says nothing", () => {
  assert.equal(managerConfigValue(".npmrc", "registry=https://registry.npmjs.org/\nsave-exact=true\n"), null);
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    ".npmrc": "registry=https://registry.npmjs.org/\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "proven");
});

test("an .npmrc carrying a pnpm-only setting is pnpm's", () => {
  assert.deepEqual(managerConfigValue(".npmrc", "node-linker=hoisted\n"), { manager: "pnpm", detail: "pnpm-only setting node-linker" });
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    ".npmrc": "shamefully-hoist=true\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "experimental");
});

// ---------- a declared manager always wins ----------

test("a packageManager field is the authority: configuration never downgrades it", () => {
  const f = conflict({
    "package.json": { packageManager: "pnpm@10.8.1" },
    "package-lock.json": true, "pnpm-lock.yaml": true,
    "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: false\n",
    ".github/workflows/ci.yml": wf("pnpm install --frozen-lockfile"),
  });
  assert.equal(f.tier, "proven");
  assert.match(f.fix, /^"packageManager" declares pnpm/);
});

test("a declared manager contradicted by CI stays proven", () => {
  const f = conflict({
    "package.json": { packageManager: "yarn@4.1.0" },
    "package-lock.json": true, "yarn.lock": true,
    ".yarnrc.yml": "nodeLinker: node-modules\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "proven", "declaration vs automation is the finding, not a reason to soften it");
});

// ---------- install steps alone are still the contradiction ----------

test("install steps that disagree are not 'dual support'", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    ".github/workflows/ci.yml": wf("pnpm i"),
    ".github/workflows/publish.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "proven", "testing with one manager and publishing with another ships what was never tested");
});

// ---------- per-manager configuration is recognised ----------

test("Yarn configuration counts when it carries settings", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "yarn.lock": true,
    ".yarnrc.yml": "nodeLinker: node-modules\nyarnPath: .yarn/releases/yarn-4.9.1.cjs\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "experimental");
  assert.ok(f.evidence.some((e) => e.kind === "manager-config" && e.value === "yarn"));
});

test("Bun configuration counts when it carries settings", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "bun.lock": true,
    "bunfig.toml": "[install]\nregistry = \"https://registry.npmjs.org\"\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  assert.equal(f.tier, "experimental");
  assert.ok(f.evidence.some((e) => e.kind === "manager-config" && e.value === "bun"));
});

// ---------- scoping ----------

test("configuration speaks only for the package it sits in", () => {
  // A standalone sub-package installed on its own inside another manager's
  // workspace: the root's pnpm settings must not reach into web/.
  const f = conflict({
    "package.json": {}, "pnpm-lock.yaml": true,
    "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: false\n",
    "web/package.json": {}, "web/package-lock.json": true, "web/yarn.lock": true,
    ".github/workflows/ci.yml": wf("npm ci"),
  }, "web");
  assert.equal(f.scope, "web");
  assert.equal(f.tier, "proven", "the root's pnpm settings are not evidence about web/");
  assert.ok(!f.evidence.some((e) => e.kind === "manager-config"));
});

test("configuration in a directory with no package.json is not charged to a parent", () => {
  const scanned = scan({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    "tools/pnpm-workspace.yaml": "allowBuilds:\n  esbuild: false\n",
    ".github/workflows/ci.yml": wf("npm ci"),
  });
  const f = scanned.findings.find((x) => x.rule === "package-manager/conflicting-config");
  assert.equal(f.tier, "proven");
});

// ---------- deliberate dual-lockfile maintenance ----------

test("two managers each carrying their own settings is ambiguous", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "bun.lock": true,
    "bunfig.toml": "[install]\nfrozenLockfile = true\n",
    ".npmrc": "node-linker=hoisted\n",
    "pnpm-lock.yaml": true,
  });
  assert.equal(f.tier, "experimental");
  assert.match(f.summary, /ambiguity/);
});

test("a healthy single-manager repository with settings reports nothing", () => {
  const findings = scan({
    "package.json": { packageManager: "pnpm@10.8.1" },
    "pnpm-lock.yaml": true,
    "pnpm-workspace.yaml": "packages:\n  - 'apps/*'\nallowBuilds:\n  esbuild: false\n",
    ".github/workflows/ci.yml": wf("pnpm install --frozen-lockfile"),
  }).findings.filter((f) => f.class === "package.manager");
  assert.deepEqual(findings, [], "configuration alone must never raise a finding");
});
