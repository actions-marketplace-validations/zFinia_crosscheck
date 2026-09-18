// Install-step evidence attached to the proven package-manager conflict. It
// explains which manager CI, Docker and deploy steps actually use; it never
// creates, removes or changes a finding.
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
  assert.match(f.fix, /^Every install step CrossCheck found for this package uses npm \(\.github\/workflows\/ci\.yml:6, Dockerfile:2\); none uses pnpm\. If npm is your package manager, delete pnpm-lock\.yaml, keep package-lock\.json/);
  assert.match(f.fix, /If you use pnpm on purpose, make these install steps use it too\./);
  assert.ok(f.evidence.some((e) => e.kind === "install-command" && e.source === ".github/workflows/ci.yml" && e.line === 6));
});

test("installers that disagree are reported as a disagreement, with every step cited", () => {
  const f = conflict({ "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true, ".github/workflows/ci.yml": wf("pnpm i"), ".github/workflows/publish.yml": wf("npm ci") });
  assert.match(f.fix, /^Install steps for this package disagree: npm in \.github\/workflows\/publish\.yml:6; pnpm in \.github\/workflows\/ci\.yml:6\./);
});

test("a deploy command in vercel.json counts as an install step", () => {
  const f = conflict({ "package.json": {}, "package-lock.json": true, "bun.lock": true, ".github/workflows/ci.yml": wf("npm ci"), "vercel.json": { installCommand: "bun install" } });
  assert.match(f.fix, /disagree: Bun in vercel\.json; npm in \.github\/workflows\/ci\.yml:6/);
});

test("a declared packageManager keeps its fix, and a contradicting CI step is added as a note", () => {
  const f = conflict({ "package.json": { packageManager: "yarn@4.1.0" }, "package-lock.json": true, "yarn.lock": true, ".github/workflows/ci.yml": wf("npm ci") });
  assert.match(f.fix, /^"packageManager" declares Yarn\. Remove package-lock\.json/);
  assert.match(f.fix, /Also note: \.github\/workflows\/ci\.yml:6 installs with npm\./);
});

test("without install steps the generic fix is unchanged", () => {
  assert.equal(conflict({ "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true }).fix, "Keep one lockfile: delete the one for the manager you do not use and reinstall.");
});

test("install steps for another package in a monorepo are not attached", () => {
  const f = conflict({
    "package.json": {}, "package-lock.json": true, "pnpm-lock.yaml": true,
    "web/package.json": {}, "web/pnpm-lock.yaml": true,
    ".github/workflows/ci.yml": "on: push\njobs:\n  t:\n    steps:\n      - run: pnpm install\n        working-directory: web\n",
  });
  assert.equal(f.scope, "");
  assert.ok(!f.evidence.some((e) => e.kind.startsWith("install")));
  assert.match(f.fix, /^Keep one lockfile/);
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
