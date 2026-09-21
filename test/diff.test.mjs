import test from "node:test";
import assert from "node:assert/strict";
import { repo, commit, cli, git, pkg } from "./helpers.mjs";

const PNPM = { "package.json": pkg({ next: "15.0.0" }, { packageManager: "pnpm@10.0.0" }), "pnpm-lock.yaml": "lockfileVersion: '9.0'\n" };
const diff = (dir, base, ...extra) => cli(dir, "--base", base, "--head", "HEAD", "--format", "json", ...extra).json();

test("a PR that adds package-lock.json to a pnpm repo introduces one package-manager contradiction", () => {
  const dir = repo(PNPM);
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package-lock.json": '{"lockfileVersion":3}\n' }, "agent: npm install");
  const r = diff(dir, base);
  assert.equal(r.introduced.length, 1);
  assert.equal(r.introduced[0].rule, "package-manager/conflicting-config");
  assert.deepEqual(r.introduced[0].values, ["npm", "pnpm"]);
  assert.deepEqual(r.introduced[0].newEvidence.map((e) => e.source), ["package-lock.json"]);
  assert.equal(r.introduced[0].summary, "Multiple package-manager configurations detected: npm and pnpm");
  assert.match(r.introduced[0].fix, /"packageManager" declares pnpm/);
  assert.match(r.introduced[0].fix, /If pnpm is authoritative and the other state was introduced unintentionally, remove package-lock\.json/);
  assert.equal(r.existing.length, 0);
});

test("an unrelated PR on an already-conflicted repo is not blamed for the old contradiction", () => {
  const dir = repo({ ...PNPM, "package-lock.json": "{}\n" });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "src/index.ts": "export const x = 1;\n", "README.md": "# hello\n" }, "feature");
  const r = diff(dir, base);
  assert.equal(r.introduced.length, 0);
  assert.equal(r.existing.length, 1);
  assert.equal(r.resolved.length, 0);
  const text = cli(dir, "--base", base, "--head", "HEAD").out;
  assert.match(text, /New findings: none/);
  assert.match(text, /Pre-existing \(not caused by this change/);
});

test("a PR that deletes the stray lockfile is recognised as resolving the contradiction", () => {
  const dir = repo({ ...PNPM, "package-lock.json": "{}\n" });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package-lock.json": null }, "remove stray lockfile");
  const r = diff(dir, base);
  assert.equal(r.introduced.length, 0);
  assert.equal(r.resolved.length, 1);
  assert.equal(r.resolved[0].rule, "package-manager/conflicting-config");
});

test("a third package manager added to an existing conflict counts as worsened, not pre-existing", () => {
  const dir = repo({ ...PNPM, "package-lock.json": "{}\n" });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "yarn.lock": "# yarn\n" });
  const r = diff(dir, base);
  assert.equal(r.introduced.length, 1);
  assert.equal(r.introduced[0].change, "worsened");
  assert.deepEqual(r.introduced[0].values, ["npm", "pnpm", "yarn"]);
});

test("a nested package that gains a second ORM is reported in that package only", () => {
  const dir = repo({
    "package.json": { name: "root", private: true, packageManager: "pnpm@10.0.0" }, "pnpm-lock.yaml": "x\n",
    "apps/api/package.json": pkg({ "@prisma/client": "6.0.0" }),
    "apps/web/package.json": pkg({ "drizzle-orm": "0.45.0" }),
  });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "apps/api/package.json": pkg({ "@prisma/client": "6.0.0", "drizzle-orm": "0.45.0" }) });
  const r = diff(dir, base, "--experimental");
  assert.equal(r.introduced.length, 1);
  assert.equal(r.introduced[0].scope, "apps/api");
  assert.deepEqual(r.introduced[0].values, ["drizzle", "prisma"]);
});

test("independent packages that legitimately chose differently are never merged", () => {
  const dir = repo({
    "package.json": { name: "root", private: true },
    "apps/web/package.json": pkg({ "drizzle-orm": "0.45.0", "@clerk/nextjs": "6.0.0" }), "apps/web/package-lock.json": "{}\n",
    "services/api/package.json": pkg({ "@prisma/client": "6.0.0", "next-auth": "4.0.0" }), "services/api/pnpm-lock.yaml": "x\n",
  });
  const r = cli(dir, "--format", "json", "--experimental").json();
  assert.deepEqual(r.findings, []);
});

test("adding a second auth provider is introduced; better-auth vs next-auth is recognised", () => {
  const dir = repo({ ...PNPM, "package.json": pkg({ "next-auth": "4.24.0" }, { packageManager: "pnpm@10.0.0" }) });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package.json": pkg({ "next-auth": "4.24.0", "better-auth": "1.7.0" }, { packageManager: "pnpm@10.0.0" }) });
  const r = diff(dir, base, "--experimental");
  assert.equal(r.introduced.length, 1);
  assert.equal(r.introduced[0].rule, "auth/conflicting-providers");
  assert.deepEqual(r.introduced[0].values, ["authjs", "better-auth"]);
});

test("an agent-instruction edit that contradicts the repository is introduced", () => {
  const dir = repo({ ...PNPM, "AGENTS.md": "# Agents\n\n- Package manager: pnpm\n" });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "AGENTS.md": "# Agents\n\n- Package manager: npm\n" });
  const r = diff(dir, base, "--experimental");
  assert.equal(r.introduced.length, 1);
  assert.equal(r.introduced[0].rule, "package-manager/agent-instructions");
  assert.equal(r.introduced[0].newEvidence[0].source, "AGENTS.md");
  assert.equal(r.introduced[0].newEvidence[0].line, 3);
});

test("a PR that breaks package.json is reported; a BOM is not", () => {
  const dir = repo({ ...PNPM, "package.json": "﻿" + JSON.stringify(pkg({}, { packageManager: "pnpm@10.0.0" })) });
  const base = git(dir, "rev-parse", "HEAD").trim();
  assert.equal(cli(dir, "--format", "json").json().findings.length, 0, "BOM manifest must parse");
  commit(dir, { "package.json": '{ "name": "x",\n<<<<<<< HEAD\n "a": 1\n=======\n "a": 2\n>>>>>>> b\n}' });
  const r = diff(dir, base);
  assert.equal(r.introduced.length, 1);
  assert.equal(r.introduced[0].rule, "manifest/unparseable");
});

test("diff against the working tree works without committing", () => {
  const dir = repo(PNPM);
  commit(dir, {}, "noop");
  const { writeFileSync } = require_fs();
  writeFileSync(`${dir}/package-lock.json`, "{}\n");
  const r = cli(dir, "--base", "HEAD", "--format", "json").json();
  assert.equal(r.head, "working-tree");
  assert.equal(r.introduced.length, 1);
});

test("--fail-on new exits 1 only when something new is introduced; default is advisory", () => {
  const dir = repo(PNPM);
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package-lock.json": "{}\n" });
  assert.equal(cli(dir, "--base", base, "--head", "HEAD").code, 0);
  assert.equal(cli(dir, "--base", base, "--head", "HEAD", "--fail-on", "new").code, 1);
  commit(dir, { "package-lock.json": null });
  assert.equal(cli(dir, "--base", base, "--head", "HEAD", "--fail-on", "new").code, 0);
});

test("deliberate multi-manager state is advisory by default and strict only with fail-on new", () => {
  const dir = repo({ "package.json": { name: "compatibility-fixture", private: true } });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, {
    "package.json": {
      name: "compatibility-fixture",
      private: true,
      scripts: { "build:npm": "npm ci", "build:bun": "bun install", "verify:pms": "node verify.mjs" },
    },
    "package-lock.json": "{}\n",
    "bun.lock": "# deliberate Bun compatibility state\n",
    ".github/workflows/npm.yml": "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm ci\n",
    ".github/workflows/bun.yml": "on: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: bun install --frozen-lockfile\n",
  }, "add deliberate npm and Bun compatibility coverage");

  const advisory = cli(dir, "--base", base, "--head", "HEAD");
  assert.equal(advisory.code, 0);
  assert.match(advisory.out, /Multiple package-manager configurations detected: Bun and npm/);
  assert.match(advisory.out, /may be deliberate compatibility coverage/);

  const strict = cli(dir, "--base", base, "--head", "HEAD", "--fail-on", "new");
  assert.equal(strict.code, 1);
  assert.match(strict.out, /Multiple package-manager configurations detected: Bun and npm/);
});

test("usage errors exit 2 with a clear message", () => {
  const dir = repo(PNPM);
  const r = cli(dir, "--base", "does-not-exist");
  assert.equal(r.code, 2);
  assert.match(r.err, /crosscheck:/);
  assert.equal(cli(dir, "--format", "xml").code, 2);
});

import { createRequire } from "node:module";
function require_fs() { return createRequire(import.meta.url)("node:fs"); }

test("experimental rules are hidden by default, labelled when requested, and never fail the build", () => {
  const dir = repo({ ...PNPM, "package.json": pkg({ "next-auth": "4.24.0" }, { packageManager: "pnpm@10.0.0" }) });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package.json": pkg({ "next-auth": "4.24.0", "@clerk/nextjs": "6.0.0" }, { packageManager: "pnpm@10.0.0" }) });
  const hidden = diff(dir, base);
  assert.equal(hidden.introduced.length, 0);
  assert.equal(hidden.hiddenExperimental, 1);
  const shown = cli(dir, "--base", base, "--head", "HEAD", "--format", "github", "--experimental", "--fail-on", "new");
  assert.match(shown.out, /^::notice .*CrossCheck \(experimental\)/m);
  assert.doesNotMatch(shown.out, /^::(warning|error) /m);
  assert.equal(shown.code, 0, "experimental findings must never fail the check");
});

test("default output never shows CONFLICT for a class whose finding is hidden", () => {
  const dir = repo({ "package.json": pkg({ "@prisma/client": "6.0.0", "drizzle-orm": "0.45.0" }) });
  const out = cli(dir).out;
  assert.match(out, /ORM:\s+not established \(both Drizzle and Prisma present\)/);
  assert.match(out, /Contradictions: none/);
  assert.match(cli(dir, "--experimental").out, /ORM:\s+CONFLICT \(Drizzle vs Prisma\)/);
});

test("GitHub annotations always carry a line so they attach to the introduced file", () => {
  const dir = repo(PNPM);
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package-lock.json": "{}\n" });
  const out = cli(dir, "--base", base, "--head", "HEAD", "--format", "github").out;
  assert.match(out, /^::warning file=package-lock\.json,line=1,title=/m);
});
