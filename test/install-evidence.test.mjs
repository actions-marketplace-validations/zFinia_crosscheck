// Install-step evidence attached to the default package-manager finding. It
// explains which manager CI, Docker and deploy steps actually use; it never
// creates, removes or changes a finding or infers maintainer intent.
import test from "node:test";
import assert from "node:assert/strict";
import { scanFiles } from "../src/crosscheck.mjs";
import { parseInstall } from "../src/evidence.mjs";

const scan = (files) => scanFiles(new Map(Object.entries(files).map(([k, v]) => [k, v === true ? null : typeof v === "string" ? v : JSON.stringify(v)])));
const wf = (...runs) => `on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n${runs.map((r) => `      - run: ${r}\n`).join("")}`;
const conflict = (files) => scan(files).findings.find((f) => f.rule === "package-manager/conflicting-config");

test("single installer: evidence names it and the fix is conditional, not an order", () => {
  const f = conflict({ "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf("npm ci"), Dockerfile: "FROM node:22\nRUN npm ci --omit=dev\n" });
  assert.equal(f.tier, "proven");
  assert.deepEqual(f.values, ["npm", "pnpm"]);
  assert.match(f.fix, /^Every install step CrossCheck found for this package uses npm \(\.github\/workflows\/ci\.yml:6, Dockerfile:2\); none uses pnpm\./);
  assert.match(f.fix, /extra lockfile may support dependency-update or compatibility tooling/);
  assert.match(f.fix, /do not delete it solely because CrossCheck emitted this finding/);
  assert.ok(f.evidence.some((e) => e.kind === "install-command" && e.source === ".github/workflows/ci.yml" && e.line === 6));
});

test("multiple installers are reported as possibly deliberate compatibility coverage", () => {
  const f = conflict({ "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf("pnpm i"), ".github/workflows/publish.yml": wf("npm ci") });
  assert.match(f.fix, /^Install steps use multiple package managers: npm in \.github\/workflows\/publish\.yml:6; pnpm in \.github\/workflows\/ci\.yml:6\./);
  assert.match(f.fix, /may be deliberate compatibility coverage/);
});

test("a deploy command in vercel.json counts as an install step", () => {
  const f = conflict({ "package.json": {}, "package-lock.json": true, "bun.lock": true, ".github/workflows/ci.yml": wf("npm ci"), "vercel.json": { installCommand: "bun install" } });
  assert.match(f.fix, /^Install steps use multiple package managers: Bun in vercel\.json; npm in \.github\/workflows\/ci\.yml:6\./);
  assert.match(f.fix, /may be deliberate compatibility coverage/);
});

test("a declared packageManager keeps its fix, and a contradicting CI step is added as a note", () => {
  const f = conflict({ "package.json": { packageManager: "yarn@4.1.0" }, "package-lock.json": true, "yarn.lock": true, ".github/workflows/ci.yml": wf("npm ci") });
  assert.match(f.fix, /^"packageManager" declares Yarn; other package-manager state exists in package-lock\.json\. Confirm maintainer intent/);
  assert.match(f.fix, /If Yarn is authoritative and the other state was introduced unintentionally, remove package-lock\.json/);
  assert.match(f.fix, /Also note: \.github\/workflows\/ci\.yml:6 installs with npm\./);
});

test("without install steps the generic fix does not infer intent", () => {
  const f = conflict({ "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true });
  assert.match(f.fix, /^Multiple lockfiles are present, but CrossCheck cannot determine maintainer intent\./);
  assert.doesNotMatch(f.fix, /delete|remove/iu);
});

test("install steps for another package in a monorepo are not attached", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    "web/package.json": {}, "web/pnpm-lock.yaml": true,
    ".github/workflows/ci.yml": "on: push\njobs:\n  t:\n    steps:\n      - run: pnpm install\n        working-directory: web\n",
  });
  assert.equal(f.scope, "");
  assert.ok(!f.evidence.some((e) => e.kind.startsWith("install")));
  assert.match(f.fix, /^Multiple lockfiles are present/);
});

test("deliberate npm and Bun compatibility coverage stays neutral and non-prescriptive", () => {
  const f = conflict({
    "package.json": { scripts: { "build:npm": "npm ci", "build:bun": "bun install", "verify:pms": "node verify.mjs" } },
    "package-lock.json": true,
    "bun.lock": true,
    ".github/workflows/npm.yml": wf("npm ci"),
    ".github/workflows/bun.yml": wf("bun install --frozen-lockfile"),
  });
  assert.equal(f.summary, "Multiple package-manager configurations detected: Bun and npm");
  assert.match(f.fix, /may be deliberate compatibility coverage/);
  assert.doesNotMatch(f.fix, /pick one|keep one lockfile|delete the other/iu);
});

test("Bun runtime with npm lock retained for dependency tooling does not claim misconfiguration", () => {
  const f = conflict({
    "package.json": { scripts: { start: "bun src/index.ts" } },
    "bun.lock": true,
    "package-lock.json": true,
    ".github/dependabot.yml": "version: 2\nupdates:\n  - package-ecosystem: npm\n",
    ".github/workflows/release.yml": wf("bun install"),
  });
  assert.match(f.summary, /^Multiple package-manager configurations detected/);
  assert.match(f.fix, /dependency-update or compatibility tooling/);
  assert.match(f.fix, /Confirm maintainer intent/);
  assert.doesNotMatch(`${f.summary} ${f.fix}`, /confirmed misconfiguration|stale lockfile|delete package-lock/iu);
});

test("conditional, global, named-package and tool installs never count as evidence", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    ".github/workflows/ci.yml": wf("npm install -g pnpm", "npx pnpm install", "npm install typescript", "if [ -f pnpm-lock.yaml ]; then pnpm install; else npm ci; fi"),
  });
  assert.ok(!f.evidence.some((e) => e.kind.startsWith("install")));
});

test("dry runs and lockfile-only updates are not installs", () => {
  assert.equal(parseInstall("npm ci --dry-run", { ci: true }), null);
  assert.equal(parseInstall("npm install --dry-run", { ci: true }), null);
  assert.equal(parseInstall("pnpm install --lockfile-only", { ci: true }), null);
  assert.deepEqual(parseInstall("npm ci --ignore-scripts", { ci: true }), { manager: "npm", strict: true });
});

test("install evidence never turns a single-manager package into a finding", () => {
  assert.deepEqual(scan({ "package.json": {}, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf("pnpm install --frozen-lockfile") }).findings, []);
});
