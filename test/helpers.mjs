import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "crosscheck.mjs");
const ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" };

export function repo(files) {
  const dir = mkdtempSync(join(tmpdir(), "cc-"));
  git(dir, "init", "-q", "-b", "main");
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base", "--allow-empty");
  return dir;
}
export function write(dir, files) {
  for (const [p, v] of Object.entries(files)) {
    const abs = join(dir, p);
    if (v === null) { rmSync(abs, { force: true }); continue; }
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, typeof v === "string" ? v : JSON.stringify(v, null, 2) + "\n");
  }
}
export function commit(dir, files, msg = "change") {
  write(dir, files);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "--allow-empty", "-m", msg);
  return git(dir, "rev-parse", "HEAD").trim();
}
export function git(dir, ...args) {
  return execFileSync("git", args, { cwd: dir, env: ENV, encoding: "utf8" });
}
export function cli(dir, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, GITHUB_STEP_SUMMARY: "", GITHUB_OUTPUT: "" } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}
export const pkg = (deps = {}, extra = {}) => ({ name: "app", private: true, dependencies: deps, ...extra });
