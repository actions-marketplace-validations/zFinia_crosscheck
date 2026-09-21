// The benchmark's file provider. It returns the same Map<path, text|null> the
// shipped CrossCheck providers return, using the engine's own isRelevantPath /
// isPresenceOnly so the engine sees exactly the files it would see locally.
//
// Contents come from `git cat-file --batch` against the local object store, not
// from a working tree, so repositories containing paths the host OS rejects are
// still scanned instead of being silently dropped from the sample.
import { spawnSync } from "node:child_process";
import { isRelevantPath, isPresenceOnly, normalizePath } from "../../../src/evidence.mjs";

export const MAX_FILE_BYTES = 1024 * 1024;
const BS = String.fromCharCode(92);
const esc = (p) => "/" + Array.from(p).map(c => ("*?[]".includes(c) || c === BS) ? BS + c : c).join("");

export function git(cwd, args, opts = {}) {
  const r = spawnSync("git", args, { cwd, maxBuffer: 1 << 28, windowsHide: true, timeout: 180000,
    encoding: opts.input === undefined ? "utf8" : "buffer", ...opts });
  if (r.error) throw new Error(`git ${args[0]}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr || "").toString().trim().split("\n").pop()}`);
  return r.stdout;
}

export function cloneFrozen(dir, full_name, attempts = 3) {
  let lastErr = "";
  for (let i = 0; i < attempts; i++) {
    try {
      git(dir, ["clone", "-q", "--depth", "1", "--filter=blob:none", "--no-checkout",
        "--single-branch", `https://github.com/${full_name}.git`, "r"]);
      return;
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr);
}

/** Reads the frozen HEAD commit of a blobless clone. */
export function readFrozenCommit(repo) {
  const sha = git(repo, ["rev-parse", "HEAD"]).trim();
  const listing = git(repo, ["ls-tree", "-r", "HEAD", "-z"]);
  const all = [];
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    const tab = entry.indexOf("\t");
    if (tab < 0) continue;
    const [, type, oid] = entry.slice(0, tab).split(/\s+/);
    if (type !== "blob") continue;
    all.push({ path: normalizePath(entry.slice(tab + 1)), oid });
  }
  const relevant = all.filter(f => isRelevantPath(f.path)).sort((a, b) => a.path < b.path ? -1 : 1);
  const presence = relevant.filter(f => isPresenceOnly(f.path));
  const wanted = relevant.filter(f => !isPresenceOnly(f.path));

  const files = new Map();
  for (const f of presence) files.set(f.path, null);
  let oversize = 0, checkoutNote = null;
  if (wanted.length) {
    // sparse-checkout only exists to make git batch-fetch the missing blobs in one
    // round trip. A checkout error does not matter: the pack is already fetched.
    try {
      git(repo, ["sparse-checkout", "init", "--no-cone"]);
      git(repo, ["sparse-checkout", "set", "--no-cone", "--stdin"],
        { input: Buffer.from(wanted.map(f => esc(f.path)).join("\n") + "\n"), encoding: "buffer" });
      git(repo, ["-c", "core.protectNTFS=false", "checkout", "-q", "HEAD"]);
    } catch (e) { checkoutNote = String(e.message).slice(0, 160); }

    const out = git(repo, ["cat-file", "--batch"],
      { input: Buffer.from(wanted.map(f => f.oid).join("\n") + "\n"), encoding: "buffer" });
    let offset = 0;
    for (const f of wanted) {
      const nl = out.indexOf(0x0a, offset);
      if (nl < 0) break;
      const header = out.slice(offset, nl).toString("utf8").split(" ");
      const size = Number(header[2]);
      offset = nl + 1;
      if (header[1] === "missing" || Number.isNaN(size)) continue;
      if (size <= MAX_FILE_BYTES) files.set(f.path, out.slice(offset, offset + size).toString("utf8"));
      else oversize++;
      offset += size + 1;
    }
  }
  return { sha, files, allPaths: all.map(f => f.path), relevant: relevant.map(f => f.path),
           lockfiles: presence.map(f => f.path), oversize, checkoutNote };
}
