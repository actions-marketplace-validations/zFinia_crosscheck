// File providers. Both return Map<path, text|null> containing only the paths
// CrossCheck reads (isRelevantPath). Lockfile contents are never read.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isRelevantPath, isPresenceOnly, SKIP_DIRS, MAX_DEPTH } from "./evidence.mjs";

const MAX_FILE_BYTES = 1024 * 1024;

/** Reads the working tree under `root`. */
export function readWorkingTree(root) {
  const files = new Map();
  const walk = (rel, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || (entry.name.startsWith(".") && entry.name !== ".github")) continue;
        walk(path, depth + 1);
      } else if (entry.isFile() && isRelevantPath(path)) {
        if (isPresenceOnly(path)) { files.set(path, null); continue; }
        try {
          if (statSync(join(root, path)).size > MAX_FILE_BYTES) continue;
          files.set(path, readFileSync(join(root, path), "utf8"));
        } catch { /* unreadable: treated as absent */ }
      }
    }
  };
  walk("", 0);
  return files;
}

function git(cwd, args, input) {
  const r = spawnSync("git", args, { cwd, input, encoding: input === undefined ? "utf8" : "buffer", maxBuffer: 1 << 30, windowsHide: true });
  if (r.status !== 0) {
    const err = (r.stderr || "").toString().trim().split("\n").pop();
    throw new Error(`git ${args[0]} failed: ${err || `exit ${r.status}`}`);
  }
  return r.stdout;
}

export function resolveRef(cwd, ref) {
  return git(cwd, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
}

/** Reads a commit without checking it out: one ls-tree plus one cat-file batch. */
export function readCommit(cwd, ref) {
  const sha = resolveRef(cwd, ref);
  const listing = git(cwd, ["ls-tree", "-r", "-z", "--long", sha]);
  const wanted = [];
  const files = new Map();
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    // "<mode> <type> <object> <size>\t<path>"
    const tab = entry.indexOf("\t");
    const [, type, object, size] = entry.slice(0, tab).split(/\s+/);
    const path = entry.slice(tab + 1);
    if (type !== "blob" || !isRelevantPath(path)) continue;
    if (isPresenceOnly(path)) { files.set(path, null); continue; }
    if (Number(size) > MAX_FILE_BYTES) continue;
    wanted.push({ path, object });
  }
  if (wanted.length) {
    const out = git(cwd, ["cat-file", "--batch"], Buffer.from(wanted.map((w) => w.object).join("\n") + "\n"));
    let offset = 0;
    for (const w of wanted) {
      const nl = out.indexOf(0x0a, offset);
      const header = out.slice(offset, nl).toString("utf8").split(" ");
      const size = Number(header[2]);
      offset = nl + 1;
      if (header[1] === "missing" || Number.isNaN(size)) continue;
      files.set(w.path, out.slice(offset, offset + size).toString("utf8"));
      offset += size + 1;
    }
  }
  return { sha, files };
}

export function isGitRepo(cwd) {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", windowsHide: true });
  return r.status === 0 && r.stdout.trim() === "true";
}

export function repoRoot(cwd) {
  return git(cwd, ["rev-parse", "--show-toplevel"]).trim();
}
