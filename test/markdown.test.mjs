// Markdown audit report: snapshot tests. Set UPDATE_SNAPSHOTS=1 to rewrite.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { repo, commit, cli, git, pkg } from "./helpers.mjs";

const SNAP = join(dirname(fileURLToPath(import.meta.url)), "snapshots");
const wf = (cmd) => `on: push\njobs:\n  t:\n    runs-on: ubuntu-latest\n    steps:\n      - run: ${cmd}\n`;
function snapshot(name, dir, out) {
  const text = out.split(basename(dir)).join("<repo>").replace(/\r\n/g, "\n");
  const file = join(SNAP, `${name}.md`);
  if (process.env.UPDATE_SNAPSHOTS || !existsSync(file)) writeFileSync(file, text);
  assert.equal(text, readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

const CONFLICTED = {
  "package.json": pkg({ next: "15.0.0" }),
  "package-lock.json": "{}\n",
  "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  ".github/workflows/ci.yml": wf("pnpm i"),
  ".github/workflows/publish.yml": wf("npm ci"),
  "AGENTS.md": "# Agents\n\n- Package manager: pnpm\n",
};

test("scan: proven finding with install-step evidence", () => {
  const dir = repo(CONFLICTED);
  const r = cli(dir, "--format", "markdown");
  assert.equal(r.code, 0);
  snapshot("scan-conflict", dir, r.out);
});

test("scan: clean repository", () => {
  const dir = repo({ "package.json": pkg({}, { packageManager: "pnpm@10.0.0" }), "pnpm-lock.yaml": "x\n", ".github/workflows/ci.yml": wf("pnpm install --frozen-lockfile") });
  snapshot("scan-clean", dir, cli(dir, "--format", "markdown").out);
});

test("scan --experimental: experimental observations are labelled not safe to block", () => {
  const dir = repo({ "package.json": pkg({}, { packageManager: "bun@1.2.0" }), "bun.lock": "x\n", "AGENTS.md": "- Package manager: npm\n" });
  const out = cli(dir, "--format", "markdown", "--experimental").out;
  assert.match(out, /EXPERIMENTAL — NOT SAFE TO BLOCK/);
  snapshot("scan-experimental", dir, out);
  assert.doesNotMatch(cli(dir, "--format", "markdown").out, /## Experimental observations/);
});

test("diff: only what the change introduced, with the file that introduced it", () => {
  const dir = repo({ "package.json": pkg({ next: "15.0.0" }, { packageManager: "pnpm@10.0.0" }), "pnpm-lock.yaml": "x\n" });
  const base = git(dir, "rev-parse", "HEAD").trim();
  commit(dir, { "package-lock.json": "{}\n" }, "agent: npm install");
  const out = cli(dir, "--base", base, "--head", "HEAD", "--format", "markdown").out;
  assert.match(out, /\*\*Introduced by:\*\* `package-lock\.json`/);
  snapshot("diff-introduced", dir, out);
});

test("markdown is deterministic and never contains the absolute path", () => {
  const dir = repo(CONFLICTED);
  const a = cli(dir, "--format", "markdown").out;
  assert.equal(a, cli(dir, "--format", "markdown").out);
  assert.ok(!a.includes(dir) && !a.includes(dir.split("\\").join("/")));
  assert.doesNotMatch(a, /\d{4}-\d{2}-\d{2}T\d{2}:/, "no timestamps");
});

test("json output is unchanged in shape (backward compatible)", () => {
  const j = cli(repo(CONFLICTED), "--format", "json").json();
  assert.deepEqual(Object.keys(j).slice(0, 3), ["version", "mode", "root"]);
  assert.equal(j.findings[0].rule, "package-manager/conflicting-config");
  assert.ok(Array.isArray(j.findings[0].evidence));
});
