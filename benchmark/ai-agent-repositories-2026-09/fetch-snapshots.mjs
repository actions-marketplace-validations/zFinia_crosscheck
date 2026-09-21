// Rebuild the exact configuration-file snapshot CrossCheck reads for a frozen set.
// usage: node fetch-snapshots.mjs <sample.json> <snapshot-dir> <crosscheck-0.1.1-dir> [concurrency]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [samplePath, outDir, engineDir, concurrency = "8"] = process.argv.slice(2);
if (!samplePath || !outDir || !engineDir) throw new Error("usage: fetch-snapshots.mjs <sample.json> <snapshot-dir> <crosscheck-0.1.1-dir> [concurrency]");
const packageJson = JSON.parse(readFileSync(join(resolve(engineDir), "package.json"), "utf8"));
if (packageJson.version !== "0.1.1") throw new Error(`expected CrossCheck 0.1.1, received ${packageJson.version}`);
const { isRelevantPath, isPresenceOnly, SKIP_DIRS, MAX_DEPTH, normalizePath } = await import(pathToFileURL(join(resolve(engineDir), "src", "evidence.mjs")));
const sample = JSON.parse(readFileSync(samplePath, "utf8"));
mkdirSync(outDir, { recursive: true });

function walkable(path) {
  const parts = normalizePath(path).split("/");
  return parts.length - 1 <= MAX_DEPTH && parts.slice(0, -1).every((part) => !SKIP_DIRS.has(part) && !(part.startsWith(".") && part !== ".github"));
}

async function snapshot(entry) {
  const output = join(outDir, `${entry.repo.replace("/", "__")}.json`);
  if (existsSync(output)) return "cached";
  if (entry.error) {
    writeFileSync(output, JSON.stringify({ repo: entry.repo, skipped: entry.error }));
    return "skipped";
  }
  let tree;
  try {
    tree = JSON.parse(execFileSync("gh", ["api", `repos/${entry.repo}/git/trees/${entry.commit}?recursive=1`], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    writeFileSync(output, JSON.stringify({ repo: entry.repo, commit: entry.commit, skipped: "tree unavailable" }));
    return "unavailable";
  }
  const files = {};
  for (const node of tree.tree) {
    if (node.type !== "blob" || !isRelevantPath(node.path) || !walkable(node.path)) continue;
    if (isPresenceOnly(node.path)) {
      files[node.path] = null;
      continue;
    }
    if (node.size > 1024 * 1024) continue;
    const rawPath = node.path.split("/").map(encodeURIComponent).join("/");
    const response = await fetch(`https://raw.githubusercontent.com/${entry.repo}/${entry.commit}/${rawPath}`);
    if (response.ok) files[node.path] = await response.text();
  }
  writeFileSync(output, JSON.stringify({ repo: entry.repo, commit: entry.commit, truncated: Boolean(tree.truncated), files }));
  return tree.truncated ? "truncated" : "ok";
}

const counts = {};
const queue = [...sample.repos];
await Promise.all(Array.from({ length: Number(concurrency) }, async () => {
  while (queue.length) {
    const status = await snapshot(queue.shift()).catch(() => "error");
    counts[status] = (counts[status] || 0) + 1;
  }
}));
console.log(`${sample.name}: ${JSON.stringify(counts)}`);
